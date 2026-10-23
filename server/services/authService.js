import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env.js";
import { requireSupabase } from "../config/supabase.js";

const providers = new Set(["google", "facebook", "apple"]);
const roles = new Set(["citizen", "authority"]);
const cleanEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function authError(message, status = 400, code = "AUTH_ERROR") {
  return Object.assign(new Error(message), { status, code });
}

function reportSupabaseAuthFailure(operation, error) {
  // Log only provider metadata. Never log credentials, email addresses, tokens, or request bodies.
  console.error("Supabase authentication request failed", {
    operation,
    name: error?.name || "AuthError",
    code: error?.code || "UNKNOWN",
    status: Number.isFinite(error?.status) ? error.status : null,
  });
}

function mapSupabaseAuthError(error, operation) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (code === "email_not_confirmed" || code === "email_not_verified" || message.includes("email not confirmed")) {
    return authError("Confirm your email using the link we sent, then try signing in again.", 403, "EMAIL_NOT_CONFIRMED");
  }
  if (["invalid_credentials", "invalid_login_credentials", "user_not_found"].includes(code) || message.includes("invalid login credentials")) {
    return authError("Email address or password is incorrect.", 401, "INVALID_CREDENTIALS");
  }
  if (["user_already_exists", "email_exists"].includes(code) || message.includes("user already registered")) {
    return authError("An account with this email already exists. Sign in instead.", 409, "USER_EXISTS");
  }
  if (code === "over_email_send_rate_limit" || message.includes("email rate limit")) {
    return authError("Too many authentication emails were requested. Wait a few minutes and try again.", 429, "AUTH_EMAIL_RATE_LIMIT");
  }

  reportSupabaseAuthFailure(operation, error);
  if (message.includes("invalid api key") || message.includes("api key is invalid")) {
    return authError("Supabase rejected the server API key. Check the Supabase secret key in the root .env file.", 503, "SUPABASE_KEY_REJECTED");
  }
  if (error?.name === "AuthRetryableFetchError" || message.includes("fetch failed") || message.includes("network")) {
    return authError("The app could not reach Supabase Authentication. Check the project URL and server network, then retry.", 503, "AUTH_SERVICE_UNAVAILABLE");
  }
  return authError("Supabase Authentication could not complete the request. Check the server log and try again.", 502, "AUTH_REQUEST_FAILED");
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.app_metadata?.role === "authority" ? "authority" : "citizen",
    name: user.user_metadata?.full_name || null,
    accountBlocked: user.app_metadata?.account_blocked === true,
    createdAt: user.created_at || null,
    phone: user.phone || user.user_metadata?.phone || null,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    passwordResetAvailable: config.isSupabaseConfigured,
  };
}

function requireRole(user, requestedRole) {
  if (!roles.has(requestedRole)) throw authError("Choose a valid portal.", 400, "INVALID_ROLE");
  const actualRole = publicUser(user).role;
  if (actualRole !== requestedRole) throw authError(`This account is registered for the ${actualRole} portal.`, 403, "ROLE_MISMATCH");
}

const MOCK_USERS_FILE = path.resolve(process.cwd(), ".mock_users.json");

// In-memory mock store for local development when Supabase is not configured
const mockUsers = new Map([
  [
    "citizen@example.com",
    {
      id: "mock-citizen-01",
      email: "citizen@example.com",
      password: "password123",
      app_metadata: { role: "citizen" },
      user_metadata: { full_name: "Citizen User" }
    }
  ],
  [
    "admin@city.gov",
    {
      id: "mock-admin-01",
      email: "admin@city.gov",
      password: "password123",
      app_metadata: { role: "authority" },
      user_metadata: { full_name: "Officer Verma" }
    }
  ]
]);

function loadPersistedMockUsers() {
  try {
    if (fs.existsSync(MOCK_USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(MOCK_USERS_FILE, "utf8"));
      if (Array.isArray(data)) {
        for (const user of data) {
          if (user?.email) mockUsers.set(user.email, user);
        }
      }
    }
  } catch {}
}

function savePersistedMockUsers() {
  try {
    const list = Array.from(mockUsers.values());
    fs.writeFileSync(MOCK_USERS_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch {}
}

loadPersistedMockUsers();

export function getPublicAppUrl(req) {
  if (config.publicAppUrl) return config.publicAppUrl;
  const protocol = req.protocol || "http";
  return `${protocol}://${req.get("host")}`;
}

export async function signUpCitizen({ name, email, password }, redirectUrl) {
  const fullName = String(name || "").trim().slice(0, 100);
  const normalizedEmail = cleanEmail(email);
  if (fullName.length < 2) throw authError("Enter your name.", 422, "INVALID_NAME");
  if (!validEmail(normalizedEmail)) throw authError("Enter a valid email address.", 422, "INVALID_EMAIL");
  if (String(password || "").length < 8) throw authError("Use a password with at least 8 characters.", 422, "INVALID_PASSWORD");

  if (!config.isSupabaseConfigured) {
    if (mockUsers.has(normalizedEmail)) {
      throw authError("An account with this email address already exists. Please sign in.", 400, "USER_EXISTS");
    }
    const newUser = {
      id: `mock-${randomUUID().slice(0, 8)}`,
      email: normalizedEmail,
      password,
      app_metadata: { role: "citizen" },
      user_metadata: { full_name: fullName },
      created_at: new Date().toISOString(),
    };
    mockUsers.set(normalizedEmail, newUser);
    savePersistedMockUsers();
    return {
      user: publicUser(newUser),
      session: { access_token: `mock-token-${newUser.id}`, refresh_token: `mock-refresh-${newUser.id}`, expires_in: 86400 },
      requiresEmailConfirmation: false
    };
  }

  const { data, error } = await requireSupabase().auth.signUp({
    email: normalizedEmail,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: redirectUrl },
  });
  if (error) throw mapSupabaseAuthError(error, "signup");
  if (!data.user) throw authError("Supabase did not return a user for this signup. Try again.", 502, "SIGNUP_RESPONSE_INVALID");
  return { user: data.user ? publicUser(data.user) : null, session: data.session, requiresEmailConfirmation: !data.session };
}

export async function signIn({ email, password, role }) {
  const normalizedEmail = cleanEmail(email);
  if (!validEmail(normalizedEmail) || !password) throw authError("Enter your email address and password.", 422, "INVALID_CREDENTIALS");

  if (!config.isSupabaseConfigured) {
    let found = mockUsers.get(normalizedEmail);
    if (!found) {
      // Auto-register demo account for local convenience
      found = {
        id: `mock-${randomUUID().slice(0, 8)}`,
        email: normalizedEmail,
        password,
        app_metadata: { role: role === "authority" ? "authority" : "citizen" },
        user_metadata: { full_name: normalizedEmail.split("@")[0].replace(/[._]/g, " ") },
        created_at: new Date().toISOString(),
      };
      mockUsers.set(normalizedEmail, found);
      savePersistedMockUsers();
    } else if (found.password && found.password !== password) {
      throw authError("Email address or password is incorrect.", 401, "INVALID_CREDENTIALS");
    }
    requireRole(found, role);
    return {
      user: publicUser(found),
      session: { access_token: `mock-token-${found.id}`, refresh_token: `mock-refresh-${found.id}`, expires_in: 86400 }
    };
  }

  const { data, error } = await requireSupabase().auth.signInWithPassword({ email: normalizedEmail, password });
  if (error) throw mapSupabaseAuthError(error, "password_signin");
  if (!data.user || !data.session) {
    if (data.user && !(data.user.email_confirmed_at || data.user.confirmed_at)) {
      throw authError("Confirm your email using the link we sent, then try signing in again.", 403, "EMAIL_NOT_CONFIRMED");
    }
    throw authError("Supabase did not return an active login session. Try again; if it continues, check the server log.", 502, "AUTH_SESSION_MISSING");
  }
  requireRole(data.user, role);
  return { user: publicUser(data.user), session: data.session };
}

export async function beginOAuth(provider, redirectUrl) {
  if (!providers.has(provider)) throw authError("This sign-in provider is not supported.", 400, "UNSUPPORTED_PROVIDER");
  throw authError("Social login is unavailable in local demo mode. Use email and password.", 503, "OAUTH_UNAVAILABLE");
}

export async function completeOAuth({ accessToken, requestedRole }) {
  if (!accessToken) throw authError("The OAuth response is incomplete. Please try again.", 400, "INVALID_OAUTH_CALLBACK");
  const { data, error } = await requireSupabase().auth.getUser(accessToken);
  if (error || !data.user) throw authError("Unable to verify the sign-in response.", 401, "INVALID_OAUTH_SESSION");
  requireRole(data.user, requestedRole);
  return publicUser(data.user);
}

export async function getUserFromAccessToken(accessToken) {
  if (!accessToken) return null;
  if (!config.isSupabaseConfigured) {
    if (accessToken.startsWith("mock-token-")) {
      const id = accessToken.replace("mock-token-", "");
      for (const u of mockUsers.values()) {
        if (u.id === id) return u;
      }
    }
    return null;
  }
  const { data, error } = await requireSupabase().auth.getUser(accessToken);
  return error || !data.user ? null : data.user;
}

export async function updateOwnProfile(user, { name, phone }) {
  const fullName = String(name || "").trim();
  const cleanPhone = String(phone || "").trim();
  if (fullName.length < 2 || fullName.length > 100) throw authError("Name must be between 2 and 100 characters.", 422, "INVALID_NAME");
  if (cleanPhone && !/^\+?[0-9()\-\s]{7,24}$/.test(cleanPhone)) throw authError("Enter a valid phone number.", 422, "INVALID_PHONE");
  if (!config.isSupabaseConfigured) {
    for (const stored of mockUsers.values()) {
      if (stored.id === user.id) {
        stored.user_metadata = { ...stored.user_metadata, full_name: fullName, phone: cleanPhone || null };
        savePersistedMockUsers();
        return publicUser(stored);
      }
    }
    throw authError("Account not found.", 404, "USER_NOT_FOUND");
  }
  const { data, error } = await requireSupabase().auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, full_name: fullName, phone: cleanPhone || null },
  });
  if (error || !data.user) throw authError("Unable to update your profile. Please try again.", 502, "PROFILE_UPDATE_FAILED");
  return publicUser(data.user);
}

export function blockMockCitizenAccount(userId) {
  if (config.isSupabaseConfigured || !userId) return;
  for (const user of mockUsers.values()) {
    if (user.id === userId && user.app_metadata?.role !== "authority") {
      user.app_metadata = { ...user.app_metadata, account_blocked: true, account_blocked_at: new Date().toISOString() };
      savePersistedMockUsers();
      return;
    }
  }
}

export function syncMockCitizenAccountBlock(userId, isBlocked) {
  if (config.isSupabaseConfigured || !userId) return;
  for (const user of mockUsers.values()) {
    if (user.id === userId && user.app_metadata?.role !== "authority") {
      user.app_metadata = { ...user.app_metadata, account_blocked: Boolean(isBlocked), account_blocked_at: isBlocked ? new Date().toISOString() : null };
      savePersistedMockUsers();
      return;
    }
  }
}

export async function requestPasswordReset(email, redirectUrl) {
  const normalizedEmail = cleanEmail(email);
  if (!validEmail(normalizedEmail)) throw authError("Enter a valid email address first.", 422, "INVALID_EMAIL");
  if (!config.isSupabaseConfigured) throw authError("Password recovery is unavailable in local demo mode.", 503, "PASSWORD_RESET_UNAVAILABLE");
  const { error } = await requireSupabase().auth.resetPasswordForEmail(normalizedEmail, { redirectTo: redirectUrl });
  if (error) throw authError("Unable to start password recovery. Please try again later.", 502, "PASSWORD_RESET_FAILED");
}
