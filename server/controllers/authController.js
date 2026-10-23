import { beginOAuth, completeOAuth, getPublicAppUrl, getUserFromAccessToken, publicUser, requestPasswordReset, signIn, signUpCitizen, updateOwnProfile } from "../services/authService.js";

const cookieOptions = (req) => ({ httpOnly: true, sameSite: "lax", secure: req.secure || process.env.NODE_ENV === "production", path: "/" });
const readCookie = (req, name) => req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
const accessToken = (req) => req.get("authorization")?.replace(/^Bearer\s+/i, "") || readCookie(req, "urban_aid_access");

export function setSessionCookies(req, res, session) {
  if (!session?.access_token) {
    const error = new Error("The authentication session is incomplete.");
    error.status = 400;
    error.code = "INVALID_AUTH_SESSION";
    throw error;
  }
  const options = cookieOptions(req);
  res.cookie("urban_aid_access", session.access_token, { ...options, maxAge: Math.max(60, session.expires_in || 3600) * 1000 });
  if (session.refresh_token) res.cookie("urban_aid_refresh", session.refresh_token, { ...options, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

export async function signup(req, res) {
  const result = await signUpCitizen(req.body, `${getPublicAppUrl(req)}/auth/callback`);
  if (result.session) setSessionCookies(req, res, result.session);
  res.status(201).json({ user: result.user, requiresEmailConfirmation: result.requiresEmailConfirmation });
}

export async function login(req, res) {
  const result = await signIn(req.body);
  setSessionCookies(req, res, result.session);
  res.json({ user: result.user });
}

export async function oauth(req, res) {
  const url = await beginOAuth(req.params.provider, `${getPublicAppUrl(req)}/auth/callback`);
  res.json({ url });
}

export async function oauthSession(req, res) {
  const user = await completeOAuth({ accessToken: req.body.accessToken, requestedRole: req.body.role });
  setSessionCookies(req, res, { access_token: req.body.accessToken, refresh_token: req.body.refreshToken, expires_in: req.body.expiresIn });
  res.json({ user });
}

export async function session(req, res) {
  const user = await getUserFromAccessToken(accessToken(req));
  if (!user) return res.status(401).json({ error: "UNAUTHENTICATED", message: "No active session." });
  return res.json({ user: publicUser(user) });
}

export async function updateProfile(req, res) {
  const user = await getUserFromAccessToken(accessToken(req));
  if (!user) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in to update your profile." });
  const updatedUser = await updateOwnProfile(user, { name: req.body.name, phone: req.body.phone });
  return res.json({ user: updatedUser });
}

export function logout(req, res) {
  const options = cookieOptions(req);
  res.clearCookie("urban_aid_access", options);
  res.clearCookie("urban_aid_refresh", options);
  res.status(204).end();
}

export async function forgotPassword(req, res) {
  await requestPasswordReset(req.body.email, `${getPublicAppUrl(req)}/auth/callback`);
  res.status(202).json({ message: "If that account exists, recovery instructions have been sent." });
}

export { accessToken };
