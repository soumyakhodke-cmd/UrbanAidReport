const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const state = { reports: [], adminReports: [], activeModalReport: null, authRole: "citizen", authFormMode: "signin", currentUser: null };
let reportImagePreviewUrl = null;
let resolveFalseReportDialog = null;
const t = (value) => window.urbanAidI18n?.t(value) || value;

// Initialize cached user synchronously from sessionStorage to prevent flash of unauthenticated state
try {
  const cached = sessionStorage.getItem("urbanAidUser");
  if (cached) state.currentUser = JSON.parse(cached);
} catch {}

const categoryLabels = { GARBAGE: "Garbage and waste", DRAINAGE: "Drainage and waterlogging" };
const statusLabels = { SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", ASSIGNED: "Assigned", IN_PROGRESS: "In progress", RESOLVED: "Resolved", REJECTED: "Rejected" };
const SEVERITY_POINTS = { LOW: 10, MEDIUM: 25, HIGH: 50, CRITICAL: 100 };
function getPointsForSeverity(severity, priority) {
  const s = String(severity || priority || "LOW").toUpperCase();
  return SEVERITY_POINTS[s] || 10;
}
function rewardChip(report) {
  if (report.status === "RESOLVED") {
    const pts = report.reward_points || getPointsForSeverity(report.severity, report.priority);
    return `<span class="reward-chip reward-chip-earned">⭐ +${pts} Points</span>`;
  }
  if (report.status === "REJECTED") {
    return '<span class="reward-chip reward-chip-none">Reward: Not Eligible</span>';
  }
  return '<span class="reward-chip reward-chip-pending">Reward: Pending</span>';
}

function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function formatDate(value) { return new Intl.DateTimeFormat(window.urbanAidI18n?.language === "hi" ? "hi-IN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function badge(value, kind) { if (!value) return '<span class="badge badge-neutral">Not set</span>'; return `<span class="badge ${kind}-${value.toLowerCase().replaceAll("_", "-")}">${escapeHtml(kind === "status" ? statusLabels[value] || value : value)}</span>`; }
function toast(message, tone = "") { const node = document.createElement("div"); node.className = `toast ${tone}`; node.textContent = t(message); $("#toast-region").append(node); setTimeout(() => node.remove(), 5000); }
function setError(name, message = "") { const error = $(`[data-error="${name}"]`); if (error) { error.textContent = t(message); error.closest(".field")?.classList.toggle("has-error", Boolean(message)); } }
function clearErrors(form) { $$(".field-error", form).forEach((element) => { element.textContent = ""; element.closest(".field")?.classList.remove("has-error"); }); }

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Unable to complete that request.");
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

const authModes = {
  citizen: {
    eyebrow: "Citizen Portal",
    title: "Help keep your neighborhood <span>clean and flowing.</span>",
    copy: "Report garbage buildup and drainage problems, follow municipal response, and receive verified updates.",
    subtitle: "Sign in to access your citizen dashboard.",
    emailLabel: "Email address",
    emailPlaceholder: "Enter your email",
    submitLabel: "Login as Citizen",
    features: [
      ["Report & Locate", "GPS coordinates and incident photos for field response.", "pin"],
      ["Live Tracking", "Follow status changes from submitted to resolved.", "bars"],
      ["Cleaner Neighborhoods", "Help local teams tackle waste buildup and blocked drains.", "check"]
    ],
  },
  authority: {
    eyebrow: "Official Operations Desk",
    title: "Manage. Monitor. <span>Resolve faster.</span>",
    copy: "Secure portal for municipal teams to review garbage and drainage reports, assign field crews, and post progress updates.",
    subtitle: "Sign in with your official authority credentials.",
    emailLabel: "Official email ID",
    emailPlaceholder: "Enter your official email",
    submitLabel: "Login as Authority",
    features: [
      ["Focused Operations", "Review garbage and drainage reports in one organized hub.", "files"],
      ["Assign & Act", "Route tasks to the right field officers with priority levels.", "target"],
      ["Live Analytics", "Monitor cleanup and drainage response in real time.", "chart"]
    ],
  },
};

const authIcons = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.3"/></svg>',
  bars: '<svg viewBox="0 0 24 24"><path d="M4 18V6m5 12v-8m5 8V4m5 14V8"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
  files: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 19V5m0 14h16M8 15l3-4 3 2 5-6"/></svg>',
};

function setAuthFieldError(name, message = "") {
  const error = $(`#auth-${name}-error`);
  const input = $(`#auth-${name}`);
  if (!error || !input) return;
  error.textContent = message;
  input.closest(".auth-input-group")?.classList.toggle("error", Boolean(message));
}

function setAuthDisclaimer() {
  const disclaimer = $("#auth-disclaimer");
  if (!disclaimer) return;
  if (state.authRole === "authority") {
    disclaimer.textContent = "Official municipal access only. Authorized authority accounts are managed by city administration.";
    return;
  }
  disclaimer.innerHTML = state.authFormMode === "signup"
    ? '<button class="auth-mode-link" id="auth-mode-toggle" type="button">Already have an account? <strong>Log in</strong></button>'
    : '<button class="auth-mode-link" id="auth-mode-toggle" type="button">Don’t have an account? <strong>Sign up as Citizen</strong></button>';
}

function setAuthFormMode(formMode) {
  state.authFormMode = state.authRole === "authority" ? "signin" : formMode;
  const signup = state.authFormMode === "signup";
  $("#auth-name-group").hidden = !signup;
  $("#auth-confirm-password-group").hidden = !signup;
  $("#remember-login-control").hidden = signup;
  $("#forgot-password").hidden = signup;
  $("#auth-social").hidden = state.authRole === "authority";
  $("#auth-title").textContent = signup ? "Create Citizen Account" : state.authRole === "authority" ? "Authority Login" : "Citizen Login";
  $("#auth-subtitle").textContent = signup ? "Sign up to start reporting issues and tracking progress." : authModes[state.authRole].subtitle;
  $("#auth-password").autocomplete = signup ? "new-password" : "current-password";
  $("#auth-submit").innerHTML = `${signup ? "Create Citizen Account" : authModes[state.authRole].submitLabel} <span aria-hidden="true">→</span>`;
  setAuthDisclaimer();
  ["name", "email", "password", "confirm-password"].forEach((name) => setAuthFieldError(name));
}

function setAuthMode(role) {
  const mode = authModes[role];
  if (!mode) return;
  state.authRole = role;
  document.body.classList.toggle("authority-mode", role === "authority");
  $$('[data-auth-role]').forEach((button) => {
    const active = button.dataset.authRole === role;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $("#auth-story-eyebrow").textContent = mode.eyebrow;
  $("#auth-story-title").innerHTML = mode.title;
  $("#auth-story-copy").textContent = mode.copy;
  $("#auth-email-label").textContent = mode.emailLabel;
  $("#auth-email").placeholder = mode.emailPlaceholder;
  $("#auth-feature-list").innerHTML = mode.features.map(([title, copy, icon]) => `<article><span class="auth-feature-icon" aria-hidden="true">${authIcons[icon]}</span><div><strong>${title}</strong><p>${copy}</p></div></article>`).join("");
  setAuthFormMode(role === "authority" ? "signin" : state.authFormMode);
}

function authErrorMessage(error) { return error?.message || "Unable to sign in. Please check your details and try again."; }

function updateNavForUser() {
  const user = state.currentUser;
  const isAuth = Boolean(user);
  const isAuthority = user?.role === "authority";
  const isCitizen = user?.role === "citizen";
  const isCitizenBlocked = isCitizen && user?.accountBlocked === true;

  // Brand link
  const brandLink = $("#site-brand");
  if (brandLink) {
    brandLink.href = !isAuth ? "#home" : isAuthority ? "#admin" : "#citizen-dashboard";
  }

  // Public Landing Navigation links - HIDE when authenticated so users only see portal features!
  const publicNavLinks = [
    $("#nav-home"),
    $("#nav-about"),
    $("#nav-services"),
    $("#nav-plans"),
    $("#nav-gallery"),
    $("#nav-track-public"),
    $("#nav-search-btn")
  ];
  publicNavLinks.forEach((el) => {
    if (el) el.hidden = isAuth;
  });

  // Citizen Portal Nav links - ONLY show for authenticated Citizen
  const navCitizenDash = $("#nav-citizen-dash");
  const navReport = $("#nav-report");
  const navReports = $("#nav-reports");

  if (navCitizenDash) navCitizenDash.hidden = !isCitizen;
  if (navReport) navReport.hidden = !isCitizen || isCitizenBlocked;
  if (navReports) navReports.hidden = !isCitizen;

  // Authority Portal Nav links - ONLY show for authenticated Authority
  const navAdmin = $("#nav-admin");
  const navAdminAnalytics = $("#nav-admin-analytics");

  if (navAdmin) navAdmin.hidden = !isAuthority;
  if (navAdminAnalytics) navAdminAnalytics.hidden = !isAuthority;

  // Profile link - ONLY show for authenticated user
  const navProfile = $("#nav-profile");
  if (navProfile) navProfile.hidden = !isAuth;

  // Header controls
  const navSignin = $("#nav-signin");
  const navUserGroup = $("#nav-user-group");
  const navUserBadge = $("#nav-user-badge");
  const navSignout = $("#nav-signout");
  const navActionReport = $("#nav-action-report");

  if (isAuth) {
    if (navSignin) navSignin.hidden = true;
    if (navUserGroup) navUserGroup.hidden = false;
    if (navSignout) navSignout.hidden = false;
    if (navUserBadge) {
      navUserBadge.textContent = isAuthority ? `🏛️ ${user.name || "Official"}` : `👤 ${user.name || "Citizen"}`;
      navUserBadge.title = user.email || "";
    }
    if (navActionReport) navActionReport.hidden = !isCitizen || isCitizenBlocked;
  } else {
    if (navSignin) navSignin.hidden = false;
    if (navUserGroup) navUserGroup.hidden = true;
    if (navSignout) navSignout.hidden = true;
    if (navActionReport) navActionReport.hidden = true;
  }
  const restrictionBanner = $("#account-blocked-report-banner");
  const historyBanner = $("#account-blocked-history-banner");
  if (restrictionBanner) restrictionBanner.hidden = !isCitizenBlocked;
  if (historyBanner) historyBanner.hidden = !isCitizenBlocked;
  const reportForm = $("#report-form");
  if (reportForm) reportForm.querySelectorAll("input,textarea,select,button").forEach((control) => { control.disabled = isCitizenBlocked; });
}

async function handleLogout() {
  const signoutButtons = [$("#nav-signout"), $("#profile-signout")];
  signoutButtons.forEach((btn) => { if (btn) { btn.disabled = true; btn.textContent = "Signing out…"; } });
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  state.currentUser = null;
  state.reports = [];
  state.adminReports = [];
  sessionStorage.removeItem("urbanAidUser");
  sessionStorage.removeItem("urbanAidAfterLogin");
  const reportForm = $("#report-form");
  if (reportForm) reportForm.reset();
  clearReportImagePreview(true);
  updateReportCategoryGuidance();
  const nameField = $("#reporterName");
  const emailField = $("#reporterEmail");
  if (nameField) nameField.value = "";
  if (emailField) emailField.value = "";
  updateNavForUser();
  signoutButtons.forEach((btn) => { if (btn) { btn.disabled = false; btn.textContent = "Sign out"; } });
  location.hash = "login";
  toast("You have been signed out.", "success");
}

function finishAuthentication(user) {
  state.currentUser = user;
  sessionStorage.setItem("urbanAidUser", JSON.stringify({ role: user.role, name: user.name || "", email: user.email || "", accountBlocked: user.accountBlocked === true }));
  updateNavForUser();
  const requestedView = sessionStorage.getItem("urbanAidAfterLogin");
  sessionStorage.removeItem("urbanAidAfterLogin");
  const targetView = user.role === "authority" ? "admin" : requestedView === "reports" ? "reports" : requestedView === "report" ? "report" : "citizen-dashboard";
  if (location.hash === `#${targetView}`) {
    showViewFromHash();
  } else {
    location.hash = targetView;
  }
  toast(`Welcome, ${user.name || (user.role === "authority" ? "Officer" : "Citizen")}.`, "success");
}

async function handlePortalLogin(event) {
  event.preventDefault();
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const signup = state.authFormMode === "signup";
  const emailName = state.authRole === "authority" ? "official email address" : "email address";
  const emailError = !email ? `Enter your ${emailName}.` : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `Enter a valid ${emailName}.` : "";
  const passwordError = !password ? "Enter your password." : signup && password.length < 8 ? "Use at least 8 characters." : "";
  const nameError = signup && $("#auth-name").value.trim().length < 2 ? "Enter your full name." : "";
  const confirmError = signup && password !== $("#auth-confirm-password").value ? "Passwords do not match." : "";
  setAuthFieldError("name", nameError); setAuthFieldError("email", emailError); setAuthFieldError("password", passwordError); setAuthFieldError("confirm-password", confirmError);
  if (nameError || emailError || passwordError || confirmError) return;
  const button = $("#auth-submit");
  button.disabled = true; button.textContent = signup ? "Creating account…" : "Signing in…";
  try {
    const data = signup
      ? await api("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: $("#auth-name").value.trim(), email, password }) })
      : await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, role: state.authRole }) });
    if (data.requiresEmailConfirmation) { toast("Check your email to confirm your account, then return here to log in.", "success"); setAuthFormMode("signin"); return; }
    finishAuthentication(data.user);
  } catch (error) { toast(authErrorMessage(error), "error"); }
  finally { button.disabled = false; setAuthFormMode(state.authFormMode); }
}

async function beginOAuth(provider) {
  const button = $(`[data-oauth-provider="${provider}"]`); const original = button.textContent;
  button.disabled = true; button.textContent = "Connecting…";
  try { sessionStorage.setItem("urbanAidPendingRole", state.authRole); const data = await api(`/api/auth/oauth/${provider}`); location.assign(data.url); }
  catch (error) { button.disabled = false; button.textContent = original; toast(authErrorMessage(error), "error"); }
}

async function handleForgotPassword() {
  const email = $("#auth-email").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthFieldError("email", "Enter your email address first."); return; }
  try { await api("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }); toast("If that account exists, recovery instructions have been sent.", "success"); }
  catch (error) { toast(authErrorMessage(error), "error"); }
}

async function restoreAuthentication() {
  if (location.pathname === "/auth/callback") {
    const params = new URLSearchParams(location.hash.slice(1)); const accessToken = params.get("access_token");
    if (accessToken) {
      try {
        const data = await api("/api/auth/oauth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken, refreshToken: params.get("refresh_token"), expiresIn: Number(params.get("expires_in")), role: sessionStorage.getItem("urbanAidPendingRole") || "citizen" }) });
        sessionStorage.removeItem("urbanAidPendingRole"); history.replaceState(null, "", "/"); finishAuthentication(data.user); return;
      } catch (error) { history.replaceState(null, "", "/"); toast(authErrorMessage(error), "error"); }
    } else if (location.search || location.hash) { history.replaceState(null, "", "/"); toast("Your email has been confirmed. Log in to continue.", "success"); }
  }
  try {
    const data = await api("/api/auth/session");
    state.currentUser = data.user;
    sessionStorage.setItem("urbanAidUser", JSON.stringify({ role: data.user.role, name: data.user.name || "", email: data.user.email || "" }));
    updateNavForUser();
    const landingHashes = ["#login", "#home", "#about", "#services", "#plans", "#gallery", "#why-us", ""];
    if (landingHashes.includes(location.hash)) {
      location.hash = data.user.role === "authority" ? "admin" : "citizen-dashboard";
    } else {
      showViewFromHash();
    }
  } catch {
    state.currentUser = null;
    sessionStorage.removeItem("urbanAidUser");
    updateNavForUser();
    const id = location.hash.slice(1);
    if (id && id !== "login") showViewFromHash();
  }
}

function showViewFromHash() {
  const hash = location.hash.slice(1);
  const user = state.currentUser;
  const isAuth = Boolean(user);
  const isAuthority = user?.role === "authority";
  const isCitizen = user?.role === "citizen";

  // If authenticated, do NOT show public marketing sections; direct user to their dashboard!
  const homeSections = ["home", "about", "services", "plans", "gallery", "why-us"];
  if (homeSections.includes(hash)) {
    if (isAuth) {
      location.hash = isAuthority ? "admin" : "citizen-dashboard";
      return;
    }
    const homeView = document.getElementById("home");
    if (homeView) {
      $$(".view").forEach((view) => view.classList.toggle("active", view === homeView));
      document.body.classList.remove("auth-active");

      $$(".main-nav a").forEach((link) => {
        const isCurrent = link.getAttribute("href") === `#${hash || "home"}`;
        if (isCurrent) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });

      $$(".main-nav").forEach((nav) => nav.classList.remove("open"));
      $(".menu-button")?.setAttribute("aria-expanded", "false");
      $(".menu-button")?.setAttribute("aria-label", "Open navigation");

      if (hash && hash !== "home") {
        const section = document.getElementById(hash);
        if (section) {
          section.scrollIntoView({ behavior: "smooth" });
        }
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      return;
    }
  }

  // Access control check: If not logged in, enforce redirect to #login for protected views
  if (!isAuth) {
    if (hash === "admin" || hash === "admin-analytics" || hash === "admin-detail") {
      setAuthMode("authority");
      sessionStorage.setItem("urbanAidAfterLogin", hash);
      if (location.hash !== "#login") location.hash = "login";
      toast("Sign in with an authority account to access the Operations Desk.", "error");
      return;
    }
    const publicViews = ["login", "track"];
    if (hash && !publicViews.includes(hash)) {
      setAuthMode("citizen");
      sessionStorage.setItem("urbanAidAfterLogin", hash);
      location.hash = "login";
      toast("Please sign in as a citizen to continue.", "error");
      return;
    }
  } else {
    // If authenticated citizen attempts to access authority page
    if (isCitizen && (hash === "admin" || hash === "admin-analytics" || hash === "admin-detail")) {
      location.hash = "citizen-dashboard";
      toast("Unauthorized: Authority access required.", "error");
      return;
    }
    // If authenticated authority attempts to access citizen-specific views
    if (isAuthority && (hash === "citizen-dashboard" || hash === "report" || hash === "reports")) {
      location.hash = "admin";
      toast("Authority accounts use the Operations Desk.", "error");
      return;
    }
    // If authenticated user navigates to #login, redirect to their home portal
    if (hash === "login") {
      location.hash = isAuthority ? "admin" : "citizen-dashboard";
      return;
    }
  }

  const defaultView = !isAuth ? "home" : isAuthority ? "admin" : "citizen-dashboard";
  const id = hash || defaultView;
  const target = document.getElementById(id) || document.getElementById(defaultView);

  $$(".view").forEach((view) => view.classList.toggle("active", view === target));
  document.body.classList.toggle("auth-active", target?.id === "login");

  $$(".main-nav a").forEach((link) => {
    const isCurrent = link.getAttribute("href") === `#${target?.id}`;
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  $$(".main-nav").forEach((nav) => nav.classList.remove("open"));
  $(".menu-button")?.setAttribute("aria-expanded", "false");
  $(".menu-button")?.setAttribute("aria-label", "Open navigation");

  // View-specific data loading
  if (target?.id === "citizen-dashboard" && isCitizen) loadCitizenDashboard();
  if (target?.id === "reports" && isCitizen) loadMyReports();
  if ((target?.id === "admin" || target?.id === "admin-analytics") && isAuthority) loadAdminReports();
  if (target?.id === "admin-detail" && isAuthority) {
    const activeId = state.activeAdminReportId || sessionStorage.getItem("activeAdminReportId");
    if (activeId) loadAdminReportDetail(activeId);
    else location.hash = "admin";
  }
  if (target?.id === "profile" && isAuth) loadProfile();

  // Pre-fill reporter fields on #report
  if (target.id === "report" && isCitizen && user) {
    const nameField = $("#reporterName");
    const emailField = $("#reporterEmail");
    if (nameField && user.name) nameField.value = user.name;
    if (emailField && user.email) emailField.value = user.email;
  }

  window.scrollTo({ top: 0, behavior: "instant" });
}

async function loadProfile() {
  if (!state.currentUser) return;
  const status = $("#profile-data-state");
  const citizenArea = $("#profile-citizen-content");
  const isCitizen = state.currentUser.role === "citizen";
  citizenArea.hidden = !isCitizen;
  $("#profile-authority-note").hidden = isCitizen;
  if (status) { status.hidden = false; status.textContent = "Loading your account data…"; }
  try {
    const session = await api("/api/auth/session");
    const user = session.user;
    state.currentUser = user;
    sessionStorage.setItem("urbanAidUser", JSON.stringify(user));
    renderProfileIdentity(user);
    if (!isCitizen) { if (status) status.hidden = true; return; }
    const [reportsResult, walletResult] = await Promise.allSettled([api("/api/reports/mine"), api("/api/wallet")]);
    let hasError = false;
    if (reportsResult.status === "fulfilled") {
      const reports = reportsResult.value.reports || [];
      state.reports = reports;
      const count = (predicate) => reports.filter(predicate).length;
      const summary = reportsResult.value.summary || { total: reports.length, resolved: count((r) => r.status === "RESOLVED"), active: count((r) => ["SUBMITTED", "UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS"].includes(r.status)) };
      $("#profile-total-reports").textContent = String(summary.total);
      $("#profile-resolved-reports").textContent = String(summary.resolved);
      $("#profile-active-reports").textContent = String(summary.active);
      $("#profile-false-report-count").textContent = String(Number(reportsResult.value.falseReportCount || 0));
      renderProfileReports(reports.slice(0, 5));
    } else { hasError = true; $("#profile-recent-reports").innerHTML = '<p class="profile-muted">Your reports could not be loaded.</p>'; }
    if (walletResult.status === "fulfilled" && walletResult.value.wallet) renderProfileWallet(walletResult.value.wallet);
    else { hasError = true; $("#profile-transactions").innerHTML = '<p class="profile-muted">Wallet activity could not be loaded.</p>'; }
    if (status) {
      status.hidden = !hasError;
      status.innerHTML = hasError ? 'Some account data could not be loaded. <button type="button" id="profile-retry" class="profile-text-button">Retry</button>' : "";
    }
  } catch (error) {
    if (status) { status.hidden = false; status.innerHTML = `${escapeHtml(error.message)} <button type="button" id="profile-retry" class="profile-text-button">Retry</button>`; }
  }
}

async function refreshProfileFalseReportCount() {
  if (location.hash !== "#profile" || state.currentUser?.role !== "citizen") return;
  try {
    const result = await api("/api/reports/mine/false-report-count");
    const counter = $("#profile-false-report-count");
    if (counter) counter.textContent = String(Number(result.falseReportCount || 0));
  } catch {
    // Keep the last successfully loaded count visible if a background refresh fails.
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#profile-edit-save");
  const errorEl = $("#profile-edit-error");
  errorEl.hidden = true;
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const data = await api("/api/auth/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.elements.name.value, phone: form.elements.phone.value }) });
    state.currentUser = data.user;
    sessionStorage.setItem("urbanAidUser", JSON.stringify(data.user));
    renderProfileIdentity(data.user);
    $("#profile-edit-dialog").close();
    toast("Profile updated successfully.", "success");
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
  } finally { button.disabled = false; button.textContent = "Save changes"; }
}

async function sendProfilePasswordReset() {
  const button = $("#profile-password-reset");
  button.disabled = true;
  try {
    await api("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: state.currentUser?.email }) });
    toast("If that account exists, recovery instructions have been sent.", "success");
  } catch (error) { toast(error.message, "error"); }
  finally { button.disabled = false; }
}

function renderProfileIdentity(user) {
  const displayName = user.name || (user.role === "authority" ? "Municipal authority" : "Citizen");
  const isAuthority = user.role === "authority";
  $("#profile-name").textContent = displayName;
  $("#profile-email").textContent = user.email || "";
  $("#profile-avatar").textContent = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
  $("#profile-badge").textContent = isAuthority ? "Municipal authority" : "Citizen account";
  $("#profile-badge").className = `badge ${isAuthority ? "badge-authority" : "badge-citizen"}`;
  $("#profile-verified").hidden = user.emailVerified !== true;
  $("#profile-password-reset").hidden = user.passwordResetAvailable !== true;
  const created = user.createdAt ? formatDate(user.createdAt) : "Not available";
  $("#profile-created").textContent = user.createdAt ? `Member since ${created}` : "Account creation date unavailable";
  $("#profile-detail-name").textContent = displayName;
  $("#profile-detail-email").textContent = user.email || "Not available";
  $("#profile-detail-phone").textContent = user.phone || "Not provided";
  $("#profile-detail-role").textContent = isAuthority ? "Municipal authority" : "Citizen";
  $("#profile-detail-created").textContent = created;
  const language = window.urbanAidI18n?.language === "hi" ? "Hindi" : "English";
  $("#profile-detail-language").textContent = language;
  $("#profile-edit-name").value = user.name || "";
  $("#profile-edit-phone").value = user.phone || "";
  $("#profile-security-copy").textContent = user.accountBlocked ? "Your account is blocked from submitting reports. You can still review decisions and submit an appeal." : "This profile reflects the account currently signed in on this device.";
}

function renderProfileWallet(wallet) {
  $("#profile-points").textContent = String(wallet.balance);
  $("#profile-wallet-balance").textContent = String(wallet.balance);
  $("#profile-wallet-earned").textContent = `${wallet.totalEarned} points`;
  const transactions = wallet.transactions || [];
  $("#profile-transactions").innerHTML = transactions.length ? transactions.slice(0, 4).map((item) => `<div class="profile-transaction"><span class="profile-transaction-icon ${item.points < 0 ? "is-deduction" : ""}">${item.points < 0 ? "−" : "+"}</span><div><strong>${escapeHtml(item.report_title || item.reason || "Wallet activity")}</strong><small>${escapeHtml(item.transaction_type?.replaceAll("_", " ") || "Reward")} · ${escapeHtml(formatDate(item.created_at))}</small></div><b class="${item.points < 0 ? "is-negative" : ""}">${item.points > 0 ? "+" : ""}${Number(item.points)} pts</b></div>`).join("") : '<p class="profile-muted">No wallet activity yet.</p>';
}

function renderProfileReports(reports) {
  const list = $("#profile-recent-reports");
  if (!reports.length) { list.innerHTML = '<p class="profile-muted">No reports submitted from this account yet. <a href="#report">Report a local issue</a>.</p>'; return; }
  list.innerHTML = reports.map((report) => `<article class="profile-report-row"><div class="profile-report-mark" aria-hidden="true">${report.category === "DRAINAGE" ? "≈" : "▤"}</div><div class="profile-report-copy"><span>${escapeHtml(report.reference_no || "")}</span><h3><button type="button" data-report-id="${escapeHtml(report.id)}">${escapeHtml(report.title || "Untitled report")}</button></h3><small>${escapeHtml(categoryLabels[report.category] || report.category || "Issue")} · ${escapeHtml(formatDate(report.created_at))}</small></div><div class="profile-report-badges">${badge(report.status, "status")}${badge(report.priority || report.severity, "priority")}</div></article>`).join("");
}

async function loadCitizenWallet() {
  const user = state.currentUser;
  if (!user || user.role !== "citizen") return;

  try {
    const data = await api("/api/wallet");
    const wallet = data.wallet || { balance: 0, totalEarned: 0, totalReported: 0, totalResolved: 0, transactions: [] };

    const balanceEl = $("#wallet-balance");
    const earnedEl = $("#wallet-total-earned");
    const resolvedEl = $("#wallet-issues-resolved");
    const reportedEl = $("#wallet-issues-reported");
    const countEl = $("#wallet-history-count");
    const profileBadge = $("#profile-wallet-badge");

    if (balanceEl) balanceEl.textContent = String(wallet.balance);
    if (earnedEl) earnedEl.textContent = `${wallet.totalEarned} Points`;
    if (resolvedEl) resolvedEl.textContent = String(wallet.totalResolved);
    if (reportedEl) reportedEl.textContent = String(wallet.totalReported);
    if (countEl) countEl.textContent = `${wallet.transactions?.length || 0} rewards`;
    if (profileBadge) {
      profileBadge.textContent = `⭐ ${wallet.balance} Points`;
      profileBadge.hidden = false;
    }

    const listEl = $("#wallet-history-list");
    if (listEl) {
      if (!wallet.transactions || !wallet.transactions.length) {
        listEl.innerHTML = `
          <div class="wallet-empty-state">
            <div class="wallet-empty-icon" aria-hidden="true">🎁</div>
            <h4>No rewards yet</h4>
            <p>Report garbage and drainage problems in your neighborhood. Once a report is resolved and verified, you'll earn reward points.</p>
          </div>
        `;
      } else {
        listEl.innerHTML = wallet.transactions.map((t) => `
          <div class="transaction-item">
            <div class="tx-left">
              <span class="tx-badge ${t.points < 0 ? "tx-badge-deduction" : ""}">${t.points > 0 ? "+" : ""}${t.points} Points</span>
              <div class="tx-info">
                <h4>${escapeHtml(t.report_title || "Community cleanup report")}</h4>
                <div class="tx-meta">
                  <span class="tx-ref">${escapeHtml(t.report_ref || "UAR-REF")}</span>
                  <span>•</span>
                  <span>${escapeHtml(categoryLabels[t.report_category] || t.report_category || "Issue")}</span>
                  <span>•</span>
                  <span>Severity: ${escapeHtml(t.severity || "LOW")}</span>
                </div>
              </div>
            </div>
            <div class="tx-right">
              <span class="tx-date">${formatDate(t.created_at)}</span>
              <span class="tx-status">${t.transaction_type === "FALSE_REPORT_DEDUCTION" ? "Status: False-report point deduction" : t.transaction_type === "FALSE_REPORT_REVERSAL" ? "Status: Appeal reversal" : "Status: Issue Resolved"}</span>
            </div>
          </div>
        `).join("");
      }
    }
  } catch (error) {
    console.error("Unable to load citizen wallet:", error);
  }
}

async function checkRewardNotifications() {
  const user = state.currentUser;
  if (!user || user.role !== "citizen") return;

  try {
    const data = await api("/api/wallet/notifications");
    if (data.notifications?.length) {
      let seen = [];
      try { seen = JSON.parse(localStorage.getItem("urbanAidSeenNotifications") || "[]"); } catch {}
      const unseen = data.notifications.filter((n) => !seen.includes(n.id));
      unseen.forEach((n) => {
        if (n.type === "FALSE_REPORT_DECISION") {
          const action = t(n.action === "WARNING" ? n.warning_email_status === "SENT" ? "The authority emailed you a warning" : "The authority recorded a warning" : { POINT_DEDUCTION: "An authority deducted reward points", ACCOUNT_BLOCK: "Your account was blocked after more than five confirmed false reports", PENALTY_REVIEW: "Your repeat case is under penalty review; no monetary penalty was issued", PENALTY_NOTICE: "An authority issued a penalty notice" }[n.action] || "An authority recorded a false-report decision");
          const emailNote = n.action === "WARNING" && n.warning_email_status !== "SENT" ? ` ${t("Email status")}: ${t((n.warning_email_status || "pending").replaceAll("_", " "))}.` : "";
          toast(`${action} ${t("for report")} ${n.report_ref || t("your report")}.${emailNote} ${t("Open My Reports to read the reason and appeal.")}`, "error");
          return;
        }
        if (n.type === "FALSE_REPORT_DEDUCTION") {
          toast(`${Math.abs(n.points)} ${t("reward points were deducted after an authority decision.")} ${t("Open My Reports to read the reason and appeal.")}`, "error");
        } else if (n.type === "FALSE_REPORT_REVERSAL") {
          toast(`${t("Your appeal was accepted and")} ${n.points} ${t("reward points were restored.")}`, "success");
        } else {
        toast(`🎉 Issue Resolved!\nYour reported issue ${n.report_ref || ""} has been resolved.\nYou earned +${n.points} reward points for helping improve your city.`, "success");
        }
      });
      try { localStorage.setItem("urbanAidSeenNotifications", JSON.stringify([...seen, ...unseen.map((n) => n.id)].slice(-100))); } catch {}
      if (unseen.some((n) => n.type !== "FALSE_REPORT_DECISION")) await loadCitizenWallet();
    }
  } catch {}
}

async function loadCitizenDashboard() {
  const user = state.currentUser;
  if (!user) return;
  const nameEl = $("#cd-user-name");
  if (nameEl) nameEl.textContent = user.name || "Citizen";

  // Refresh on every dashboard entry so authority decisions made in another
  // session appear without requiring the citizen to clear browser state.
  try {
    const data = await api("/api/reports/mine");
    state.reports = data.reports || [];
  } catch {}

  const reports = state.reports;
  const count = (test) => reports.filter(test).length;
  $("#cd-stat-total").textContent = String(reports.length);
  $("#cd-stat-pending").textContent = String(count((r) => ["SUBMITTED", "UNDER_REVIEW"].includes(r.status)));
  $("#cd-stat-progress").textContent = String(count((r) => ["ASSIGNED", "IN_PROGRESS"].includes(r.status)));
  $("#cd-stat-resolved").textContent = String(count((r) => r.status === "RESOLVED"));

  // Render recent 3 reports
  const recentList = $("#cd-recent-list");
  if (recentList) {
    if (!reports.length) {
      recentList.innerHTML = `<div class="state-card"><h2>No reports filed yet</h2><p>Spotted an issue in your city? <a href="#report" class="text-link">Click here to file a report</a>.</p></div>`;
    } else {
      const recent = reports.slice(0, 3);
      recentList.innerHTML = recent.map((r) => reportCard(r, false)).join("");
    }
  }

  await loadCitizenWallet();
  void checkRewardNotifications();
}

function clientValidation(form) {
  const rules = { title: "Enter a clear title of at least 4 characters.", category: "Choose garbage or drainage.", description: "Add at least 10 characters describing the problem.", location: "Enter an address, landmark, or precise location.", reporterName: "Enter your name.", reporterEmail: "Enter a valid email address." };
  let valid = true;
  Object.entries(rules).forEach(([name, message]) => {
    const input = $(`[name="${name}"]`, form); const value = input ? input.value.trim() : "";
    const invalid = !value || (name === "title" && value.length < 4) || (name === "description" && value.length < 10) || (name === "reporterEmail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
    setError(name, invalid ? message : ""); if (invalid) valid = false;
  });
  const file = $("#image").files[0];
  if (file && (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 5 * 1024 * 1024)) { setError("image", "Upload a JPG, PNG, or WebP image no larger than 5 MB."); valid = false; }
  return valid;
}

function updateReportCategoryGuidance() {
  const category = $("#category")?.value;
  const guidance = $("#category-guidance");
  if (!guidance) return;
  guidance.textContent = category === "GARBAGE"
    ? t("Include the waste type, approximate amount, and how long it has been there.")
    : category === "DRAINAGE"
      ? t("Include what is blocked, where water collects, and how deep it gets.")
      : t("Select a category to see what details help the field team.");
}

function clearReportImagePreview(clearInput = false) {
  if (reportImagePreviewUrl) URL.revokeObjectURL(reportImagePreviewUrl);
  reportImagePreviewUrl = null;
  const preview = $("#image-preview");
  const image = $("#image-preview-img");
  if (preview) preview.hidden = true;
  if (image) image.removeAttribute("src");
  const input = $("#image");
  if (clearInput && input) input.value = "";
  const name = $("#image-name");
  if (name) name.textContent = t("Choose a photo (JPG, PNG, or WebP · up to 5 MB)");
}

function previewReportImage(file) {
  clearReportImagePreview();
  if (!file) return;
  const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!supported.has(file.type)) {
    $("#image").value = "";
    setError("image", "Choose a valid JPG, PNG, or WebP photo.");
    return;
  }
  if (!file.size || file.size > 5 * 1024 * 1024) {
    $("#image").value = "";
    if (!file.size) {
      setError("image", "The selected photo is empty. Choose another file.");
      return;
    }
    setError("image", "Photo must be no larger than 5 MB.");
    return;
  }
  reportImagePreviewUrl = URL.createObjectURL(file);
  $("#image-preview-img").src = reportImagePreviewUrl;
  $("#image-preview").hidden = false;
  $("#image-name").textContent = file.name;
  setError("image", "");
}

async function submitReport(event) {
  event.preventDefault(); const form = event.currentTarget; clearErrors(form);
  if (!clientValidation(form)) return;
  const button = $("#submit-report"); button.disabled = true; button.textContent = "Submitting…";
  try {
    const data = await api("/api/reports", { method: "POST", body: new FormData(form) });
    form.reset(); clearReportImagePreview(); updateReportCategoryGuidance();
    if (state.currentUser) {
      const nameField = $("#reporterName");
      const emailField = $("#reporterEmail");
      if (nameField && state.currentUser.name) nameField.value = state.currentUser.name;
      if (emailField && state.currentUser.email) emailField.value = state.currentUser.email;
    }
    openModal(data.report, false, true); toast("Your report was submitted successfully.", "success");
    // Reload citizen reports cache
    state.reports = [data.report, ...state.reports];
  } catch (error) {
    if (error.data?.error === "ACCOUNT_BLOCKED" && state.currentUser) {
      state.currentUser.accountBlocked = true;
      sessionStorage.setItem("urbanAidUser", JSON.stringify({ role: state.currentUser.role, name: state.currentUser.name || "", email: state.currentUser.email || "", accountBlocked: true }));
      updateNavForUser();
    }
    const fields = error.data?.fields || {}; Object.entries(fields).forEach(([name, message]) => setError(name, message));
    if (!Object.keys(fields).length) toast(error.message, "error");
  } finally { button.disabled = false; button.textContent = "Submit report"; }
}

function reportCard(report, admin = false) {
  const image = report.image_url ? `<img class="report-image" src="${escapeHtml(report.image_url)}" alt="Photo attached to report ${escapeHtml(report.reference_no)}" />` : '<div class="report-image image-placeholder">No photo</div>';
  const location = escapeHtml(report.location); const title = escapeHtml(report.title);
  const rewardHtml = admin ? "" : rewardChip(report);
  const nestedCase = report.false_report_case || report.false_report_cases;
  const decision = Array.isArray(nestedCase) ? nestedCase[0] : nestedCase;
  const actionLabels = { WARNING: "Official warning", POINT_DEDUCTION: "Points deducted", ACCOUNT_BLOCK: "Account blocked", PENALTY_REVIEW: "Penalty not configured", PENALTY_NOTICE: "Penalty notice", OVERTURNED: "Decision overturned" };
  let decisionHtml = "";
  if (decision && !admin) {
    const penalty = decision.action === "PENALTY_NOTICE" ? `<p>Penalty notice: ₹${Number(decision.penalty_amount || 0).toFixed(2)} · ${escapeHtml(decision.penalty_policy_reference || "")}</p>` : decision.action === "PENALTY_REVIEW" ? `<p>No monetary penalty has been issued because an approved local policy is not configured.</p>` : "";
    const appealStatus = decision.appeal_status === "PENDING" ? "Your appeal is awaiting authority review." : decision.appeal_status === "ACCEPTED" ? "Your appeal was accepted; the false-report decision was reversed." : decision.appeal_status === "REJECTED" ? `Your appeal was not accepted. ${escapeHtml(decision.appeal_review_note || "")}` : "";
    const accountBlocked = decision.action === "ACCOUNT_BLOCK" ? t("This account is blocked from submitting new reports. You can still sign in to review this decision and submit an appeal.") : "";
    const warningEmail = decision.action === "WARNING" ? `<p>${t("Warning email status")}: ${escapeHtml(t((decision.warning_email_status || "PENDING").replaceAll("_", " ")))}.</p>` : "";
    const appealForm = decision.appeal_status === "NOT_FILED" ? `<details class="false-report-citizen-appeal"><summary>Appeal this decision</summary><form data-false-report-appeal="${report.id}"><label for="appeal-${report.id}">Explain why you believe this decision is incorrect</label><textarea id="appeal-${report.id}" name="message" minlength="10" maxlength="1000" required placeholder="Share any details that could help the authority review your case."></textarea><button class="button button-outline" type="submit">Submit appeal</button></form></details>` : "";
    const pointMessage = decision.appeal_status === "ACCEPTED" && decision.points_deducted ? `${decision.points_deducted} ${t("points were restored after appeal.")}` : decision.points_deducted ? `${decision.points_deducted} ${t("points were deducted from your wallet.")}` : decision.action === "POINT_DEDUCTION" ? t("No wallet points were available to deduct.") : "";
    const decisionHeading = decision.action === "OVERTURNED" ? t("Authority overturned the false-report decision") : t("Authority marked this report as false");
    decisionHtml = `<aside class="citizen-false-report-notice"><strong>${decisionHeading} · ${t("Case")} ${decision.case_number}: ${escapeHtml(t(actionLabels[decision.action] || decision.action))}</strong><p><strong>${t("Authority reason")}:</strong> ${escapeHtml(decision.reason || "")}</p>${warningEmail}${pointMessage ? `<p>${pointMessage}</p>` : ""}${accountBlocked}${penalty}${appealStatus ? `<p>${escapeHtml(t(appealStatus))}</p>` : ""}${appealForm}</aside>`;
  }
  const adminDecision = decision && admin ? `<span class="badge badge-false-report">False case ${Number(decision.case_number || 0)} · ${escapeHtml(actionLabels[decision.action] || decision.action)}</span>` : "";
  return `<article class="report-card"><div>${image}</div><div class="report-card-main"><div class="report-ref">${escapeHtml(report.reference_no)}</div><h2><button type="button" data-report-id="${report.id}">${title}</button></h2><div class="report-meta"><span>${escapeHtml(categoryLabels[report.category] || report.category)}</span><span>${location}</span><span>${formatDate(report.created_at)}</span></div>${admin && report.assigned_to ? `<div class="report-meta"><span>Assigned: ${escapeHtml(report.assigned_to)}</span></div>` : ""}${decisionHtml}</div><div class="card-status">${badge(report.status, "status")}${badge(report.priority, "priority")}${adminDecision}${rewardHtml}</div></article>`;
}

function renderReports(reports, admin = false) {
  const list = admin ? $("#admin-list") : $("#reports-list"); const card = admin ? $("#admin-state") : $("#reports-state");
  if (!reports.length) { list.hidden = true; card.hidden = false; card.innerHTML = `<h2>No reports found.</h2><p>${admin ? "Try changing the search or filter criteria." : "Reports you submit with this account will appear here."}</p>`; return; }
  card.hidden = true; list.hidden = false; list.innerHTML = reports.map((report) => reportCard(report, admin)).join("");
}

async function loadMyReports() {
  $("#reports-state").hidden = false;
  $("#reports-list").hidden = true;
  $("#reports-state").textContent = "Loading your reports…";
  try {
    const data = await api("/api/reports/mine");
    state.reports = data.reports;
    try {
      const session = await api("/api/auth/session");
      state.currentUser = session.user;
      sessionStorage.setItem("urbanAidUser", JSON.stringify({ role: session.user.role, name: session.user.name || "", email: session.user.email || "", accountBlocked: session.user.accountBlocked === true }));
      updateNavForUser();
    } catch {}
    const accountCounter = $("#false-report-account-counter");
    if (accountCounter) {
      const count = Number(data.falseReportCount || 0);
      accountCounter.hidden = false;
      accountCounter.innerHTML = `${t("Authority-confirmed false reports on this account")}: <strong>${count}</strong>.<br>${t("Warnings")}: 1–2 · ${t("Point deductions")}: 3–5 · ${t("Account block")}: ${t("above 5")}.`;
    }
    renderReports(data.reports);
  } catch (error) {
    $("#reports-state").hidden = false;
    $("#reports-state").innerHTML = `<h2>Unable to load your reports.</h2><p>${escapeHtml(error.message)}</p>`;
  }
}

async function handleTrackSubmit(event) {
  event.preventDefault();
  const input = $("#track-input");
  const query = input ? input.value.trim() : "";
  const stateCard = $("#track-state");
  const resultCard = $("#track-result");

  if (!query) {
    toast("Enter a reference number or report ID to track.", "error");
    return;
  }

  stateCard.hidden = false;
  resultCard.hidden = true;
  stateCard.textContent = `Looking up report ${query}…`;

  try {
    const data = await api(`/api/reports/${encodeURIComponent(query)}`);
    const report = data.report;
    stateCard.hidden = true;
    resultCard.hidden = false;

    const updatesHtml = report.report_updates?.length
      ? `<section class="updates"><h3>Official Updates Timeline</h3>${report.report_updates.map((u) => `<div class="update"><strong>${escapeHtml(u.status ? statusLabels[u.status] || u.status : u.created_by)}</strong><p>${escapeHtml(u.message)}</p><small>${formatDate(u.created_at)}</small></div>`).join("")}</section>`
      : '<section class="updates"><h3>Official Updates</h3><p>No remarks or updates have been posted by the authority desk yet.</p></section>';

    resultCard.innerHTML = `
      <div class="state-card" style="text-align:left">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
          <span class="report-ref">${escapeHtml(report.reference_no)}</span>
          <div class="card-status">${badge(report.status, "status")}${badge(report.priority, "priority")}</div>
        </div>
        <h2 style="margin:0 0 12px; font:800 24px 'Manrope', sans-serif">${escapeHtml(report.title)}</h2>
        <p style="margin:0 0 18px; color:var(--text)">${escapeHtml(report.description)}</p>
        ${report.image_url ? `<img class="detail-image" src="${escapeHtml(report.image_url)}" alt="Photo attached to report" />` : ""}
        <div class="detail-grid">
          <div><strong>Category</strong>${escapeHtml(categoryLabels[report.category] || report.category)}</div>
          <div><strong>Location</strong>${escapeHtml(report.location)}</div>
          <div><strong>Submitted</strong>${formatDate(report.created_at)}</div>
          <div><strong>Assigned Team</strong>${escapeHtml(report.assigned_to || "Pending assignment")}</div>
        </div>
        ${updatesHtml}
      </div>
    `;
  } catch (error) {
    stateCard.hidden = false;
    resultCard.hidden = true;
    stateCard.innerHTML = `<h2>Report Not Found</h2><p>We could not find an issue matching reference "<strong>${escapeHtml(query)}</strong>". Please double-check your code.</p>`;
  }
}

function parseReportCoordinates(location) {
  const match = String(location || "").trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, label: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` };
}

function closeReportModal() {
  const modal = $("#report-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  state.activeModalReport = null;
  state.activeModalAdmin = false;
  state.modalReturnFocus?.focus?.();
  state.modalReturnFocus = null;
}

function openModal(report, admin = false, success = false) {
  state.activeModalReport = report;
  state.activeModalAdmin = admin;
  state.activeModalSuccess = success;
  if ($("#report-modal").hidden) state.modalReturnFocus = document.activeElement;

  const coordinates = parseReportCoordinates(report.location);
  const locationLink = coordinates
    ? `<a class="report-map-link" href="https://www.openstreetmap.org/?mlat=${coordinates.latitude}&mlon=${coordinates.longitude}#map=17/${coordinates.latitude}/${coordinates.longitude}" target="_blank" rel="noopener noreferrer">${t("View on Map")} ↗</a>`
    : "";
  const field = (label, value, extra = "") => `<div class="report-detail-field"><dt>${t(label)}</dt><dd>${value || `<span class="report-detail-missing">${t("Not provided")}</span>`}${extra}</dd></div>`;
  const updates = Array.isArray(report.report_updates) ? report.report_updates : [];
  const updateHtml = updates.length
    ? `<section class="report-updates"><h3>${t("Authority Updates")}</h3><ol class="report-update-timeline">${updates.map((update) => `<li class="report-update-item"><span class="report-update-marker" aria-hidden="true"></span><div class="report-update-copy"><div class="report-update-heading">${update.status ? badge(update.status, "status") : ""}<strong>${escapeHtml(update.created_by || t("Authority"))}</strong></div><p>${escapeHtml(update.message || "")}</p><time data-report-date datetime="${escapeHtml(update.created_at || "")}">${formatDate(update.created_at)}</time></div></li>`).join("")}</ol></section>`
    : `<section class="report-updates"><h3>${t("Authority Updates")}</h3><p class="report-updates-empty">${t("No authority updates have been posted yet.")}</p></section>`;

  const alreadyRewarded = report.status === "RESOLVED" && report.reward_points;
  const initialSeverity = report.severity || report.priority || "LOW";
  const initialPoints = alreadyRewarded ? report.reward_points : getPointsForSeverity(initialSeverity, report.priority);
  const rewardBoxHtml = admin ? `
    <div class="authority-reward-preview" id="modal-arp-box" style="${alreadyRewarded ? 'border-color:#1fc8b2; background:rgba(31,200,178,0.08)' : ''}">
      <div>
        <span class="arp-label" id="modal-arp-label" style="${alreadyRewarded ? 'color:#43f5d5' : ''}">${alreadyRewarded ? 'Awarded Citizen Reward' : 'Eligible Citizen Reward'}</span>
        <div class="arp-value"><span class="arp-points" id="modal-arp-points" style="${alreadyRewarded ? 'color:#43f5d5' : ''}">⭐ +${initialPoints}</span> Points <small id="modal-arp-tier" style="opacity:0.8; font-weight:500">(${initialSeverity} Severity)</small></div>
      </div>
      <span class="tier-badge ${alreadyRewarded ? '' : 'tier-' + initialSeverity.toLowerCase()}" id="modal-arp-badge" style="${alreadyRewarded ? 'background:rgba(31,200,178,0.2); color:#43f5d5' : ''}">${alreadyRewarded ? 'Resolved & Credited' : 'Auto-awarded upon Resolution'}</span>
    </div>
  ` : "";
  const adminForm = admin ? `<form id="modal-update" class="admin-update"><div><label for="update-status">Status</label><select id="update-status">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${report.status === key ? "selected" : ""}>${label}</option>`).join("")}</select></div><div><label for="update-priority">Priority</label><select id="update-priority"><option value="">Not set</option>${["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => `<option value="${value}" ${report.priority === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div><label for="update-assigned">Assigned to</label><input id="update-assigned" value="${escapeHtml(report.assigned_to || "")}" maxlength="100" placeholder="Team or officer name" /></div><div><label for="update-severity">Severity</label><select id="update-severity"><option value="">Not assessed</option>${["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => `<option value="${value}" ${report.severity === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>${rewardBoxHtml}<div><label for="update-message">Update for the citizen</label><textarea id="update-message" maxlength="500" placeholder="Explain what happened or what will happen next."></textarea></div><button class="button button-primary" type="submit">Save update</button></form>` : "";

  const photoHtml = report.image_url
    ? `<div class="report-photo-frame"><button class="report-photo-button" type="button" data-report-photo="${escapeHtml(report.image_url)}" aria-label="${t("View larger photo")}"><img class="report-detail-photo" src="${escapeHtml(report.image_url)}" alt="${t("Photo attached to this report")}" /></button><p class="report-photo-hint">${t("Select photo to enlarge")}</p><p class="report-photo-error" hidden>${t("Photo could not be loaded")}</p></div>`
    : `<div class="report-photo-frame report-photo-empty"><span class="report-photo-placeholder-icon" aria-hidden="true">▧</span><p>${t("No photo attached")}</p></div>`;
  const reporterHtml = admin ? field("Reporter", `${escapeHtml(report.reporter_name || t("Not provided"))}<br>${escapeHtml(report.reporter_email || "")}${report.reporter_phone ? `<br>${escapeHtml(report.reporter_phone)}` : ""}`) : "";
  const locationValue = escapeHtml(report.location || "");

  const submittedAt = report.created_at || new Date().toISOString();
  $("#modal-content").innerHTML = `<div class="report-detail-header"><div class="report-detail-header-copy"><h2 id="modal-title" class="report-detail-eyebrow">${t("Report Details")}</h2><p class="report-detail-reference">${t("Reference")}: <span>${escapeHtml(report.reference_no || t("Not available"))}</span></p></div><div class="report-detail-header-actions">${badge(report.status, "status")}<button class="modal-close" type="button" data-close-modal aria-label="${t("Close report details")}" title="${t("Close")}">×</button></div></div><div class="report-detail-body">${success ? `<p class="report-received-note">${t("Report received")}</p>` : ""}<div class="report-detail-main"><section class="report-photo-column" aria-label="${t("Photo evidence")}"><h3>${t("Photo evidence")}</h3>${photoHtml}</section><section class="report-information"><h3>${t("Issue Information")}</h3><h2 class="report-detail-title">${escapeHtml(report.title || t("Untitled report"))}</h2><div class="report-detail-badges">${report.priority ? badge(report.priority, "priority") : ""}${report.severity ? `<span class="report-severity-label">${t("Severity")}</span>${badge(report.severity, "priority")}` : ""}${rewardChip(report)}</div>${report.description ? `<div class="report-description-block"><h4>${t("Description")}</h4><p>${escapeHtml(report.description)}</p></div>` : ""}<dl class="report-detail-grid">${field("Category", escapeHtml(categoryLabels[report.category] || report.category || ""))}${field("Location", locationValue, locationLink)}${coordinates ? field("GPS coordinates", escapeHtml(coordinates.label)) : ""}${field("Submitted", `<time data-report-date datetime="${escapeHtml(submittedAt)}">${formatDate(submittedAt)}</time>`)}${field("Assignment", escapeHtml(report.assigned_to || ""))}${reporterHtml}</dl>${report.additional_info ? `<div class="report-description-block"><h4>${t("Additional information")}</h4><p>${escapeHtml(report.additional_info)}</p></div>` : ""}</section></div>${updateHtml}${adminForm}</div><footer class="report-detail-footer"><button class="button button-secondary" type="button" data-close-modal>${t("Close")}</button></footer>`;
  const modal = $("#report-modal");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modal.querySelector(".modal-close")?.focus();
  modal.querySelector(".report-detail-photo")?.addEventListener("error", (event) => {
    event.currentTarget.hidden = true;
    event.currentTarget.closest(".report-photo-frame")?.querySelector(".report-photo-error")?.removeAttribute("hidden");
  }, { once: true });

  if (admin && !alreadyRewarded) {
    const updatePreview = () => {
      const sev = $("#update-severity")?.value || $("#update-priority")?.value || "LOW";
      const pts = getPointsForSeverity(sev);
      const pointsEl = $("#modal-arp-points");
      const tierEl = $("#modal-arp-tier");
      const badgeEl = $("#modal-arp-badge");
      if (pointsEl) pointsEl.textContent = `⭐ +${pts}`;
      if (tierEl) tierEl.textContent = `(${sev} Severity)`;
      if (badgeEl) {
        badgeEl.className = `tier-badge tier-${sev.toLowerCase()}`;
        badgeEl.textContent = `Auto-awarded upon Resolution`;
      }
    };
    $("#update-severity")?.addEventListener("change", updatePreview);
    $("#update-priority")?.addEventListener("change", updatePreview);
  }
}
async function getReportForModal(id, admin) {
  const cached = (admin ? state.adminReports : state.reports).find((report) => report.id === id);
  if (cached) openModal(cached, admin);
  try {
    const data = await api(`/api/reports/${id}`);
    openModal(data.report, admin);
  } catch (error) {
    if (!cached) toast(error.message, "error");
  }
}

function stat(label, value) { return `<article class="stat"><p>${label}</p><strong>${value}</strong></article>`; }
function renderAdminStats(reports = []) {
  const count = (test) => reports.filter(test).length;
  const resolved = count((r) => r.status === "RESOLVED");
  const rate = reports.length ? Math.round((resolved / reports.length) * 100) : 0;
  const activeWork = count((r) => ["ASSIGNED", "IN_PROGRESS"].includes(r.status));
  const critical = count((r) => r.priority === "CRITICAL");

  const statsEl = $("#admin-stats");
  if (statsEl) {
    statsEl.innerHTML = [
      stat("Total reports", reports.length),
      stat("Pending review", count((r) => ["SUBMITTED", "UNDER_REVIEW"].includes(r.status))),
      stat("In progress", activeWork),
      stat("Resolved", resolved),
      stat("Critical priority", critical),
      stat("Resolution rate", `${rate}%`)
    ].join("");
  }

  // Analytics breakdown
  const rateEl = $("#analytics-rate");
  const activeEl = $("#analytics-active");
  const criticalEl = $("#analytics-critical");
  if (rateEl) rateEl.textContent = `${rate}%`;
  if (activeEl) activeEl.textContent = String(activeWork);
  if (criticalEl) criticalEl.textContent = String(critical);
}

async function loadAdminReports() {
  const query = new URLSearchParams();
  [["search", "#admin-search"], ["status", "#admin-status"], ["category", "#admin-category"], ["priority", "#admin-priority"]].forEach(([key, selector]) => {
    const el = $(selector);
    const value = el ? el.value : "";
    if (value) query.set(key, value);
  });
  const stateEl = $("#admin-state");
  const listEl = $("#admin-list");
  if (stateEl) {
    stateEl.hidden = false;
    stateEl.textContent = "Loading reports…";
  }
  if (listEl) listEl.hidden = true;
  try {
    const data = await api(`/api/reports/admin/all?${query}`);
    state.adminReports = data.reports || [];
    renderAdminStats(state.adminReports);
    renderReports(state.adminReports, true);
  } catch (error) {
    if (stateEl) {
      stateEl.hidden = false;
      stateEl.innerHTML = `<h2>Unable to load the operations desk.</h2><p>${escapeHtml(error.message)}</p>`;
    }
  }
}

async function saveAdminUpdate(event) {
  event.preventDefault();
  const report = state.activeModalReport;
  const button = $("#modal-update button");
  button.disabled = true; button.textContent = "Saving…";
  try {
    const data = await api(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: $("#update-status").value,
        priority: $("#update-priority").value || undefined,
        severity: $("#update-severity").value || undefined,
        assignedTo: $("#update-assigned").value,
        message: $("#update-message").value,
        author: state.currentUser?.name || "Authority desk"
      })
    });
    closeReportModal();
    if (data.reward?.awarded) {
      toast(`Report marked Resolved! ⭐ +${data.reward.points} reward points credited to citizen.`, "success");
    } else {
      toast("Report update saved.", "success");
    }
    loadAdminReports();
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
    button.textContent = "Save update";
  }
}

/* =========================================================
   17. AUTHORITY ISSUE DETAILS VIEW & INTERACTIVE MAP LOGIC
   ========================================================= */
let adminDetailMapInstance = null;

function extractCoordinates(locationStr) {
  if (!locationStr) return null;
  const match = String(locationStr).match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function initAdminDetailMap(lat, lng, report) {
  const mapContainer = document.getElementById("admin-detail-map");
  if (!mapContainer) return;

  if (adminDetailMapInstance) {
    try { adminDetailMapInstance.remove(); } catch {}
    adminDetailMapInstance = null;
  }

  if (typeof L === "undefined") {
    mapContainer.innerHTML = `<div style="display:grid; place-items:center; height:100%; color:var(--muted); font:600 13px 'Plus Jakarta Sans',sans-serif">Map unavailable</div>`;
    return;
  }

  try {
    const map = L.map(mapContainer, {
      center: [lat, lng],
      zoom: 15,
      zoomControl: true,
      scrollWheelZoom: false
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);

    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(`
      <div style="font-family:'Plus Jakarta Sans',sans-serif; font-size:12.5px; line-height:1.4">
        <strong style="color:#387cf6; font-size:11px; text-transform:uppercase">${escapeHtml(report.reference_no)}</strong>
        <div style="font-size:13.5px; font-weight:700; color:#0f1c30; margin:2px 0 4px">${escapeHtml(report.title)}</div>
        <div style="color:#64748b; font-size:11.5px">📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
      </div>
    `).openPopup();

    adminDetailMapInstance = map;

    setTimeout(() => {
      if (adminDetailMapInstance) adminDetailMapInstance.invalidateSize();
    }, 250);
  } catch (err) {
    console.error("Leaflet map initialization error:", err);
  }
}

function openAdminReportDetail(reportId) {
  state.activeAdminReportId = reportId;
  sessionStorage.setItem("activeAdminReportId", reportId);
  if (location.hash === "#admin-detail") {
    loadAdminReportDetail(reportId);
  } else {
    location.hash = "admin-detail";
  }
}

async function loadAdminReportDetail(reportId) {
  let report;
  try {
    const data = await api(`/api/reports/${reportId}`);
    report = data.report;
  } catch (error) {
    toast(`Unable to load report details: ${error.message}`, "error");
    location.hash = "admin";
    return;
  }

  state.activeAdminReport = report;
  renderAdminDetail(report);
}

function renderAdminDetail(report) {
  // 1. Header Information
  const refEl = $("#detail-ref-no");
  if (refEl) refEl.textContent = `Report ${report.reference_no}`;
  const statusBadge = $("#detail-status-badge");
  if (statusBadge) statusBadge.innerHTML = badge(report.status, "status");
  const subDate = $("#detail-submitted-date");
  if (subDate) subDate.textContent = `Submitted ${formatDate(report.created_at)}`;

  // 2. Photo Evidence
  const photoBox = $("#detail-photo-container");
  if (photoBox) {
    if (report.image_url) {
      photoBox.innerHTML = `
        <img class="detail-photo-img" src="${escapeHtml(report.image_url)}" alt="Photo evidence for ${escapeHtml(report.reference_no)}" />
        <div class="detail-photo-hover-hint">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          Click to inspect full photo
        </div>
      `;
      photoBox.onclick = () => openLightbox(report.image_url, `Report ${report.reference_no}: ${report.title}`);
    } else {
      photoBox.innerHTML = `
        <div class="detail-photo-empty">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          <span>No image provided</span>
        </div>
      `;
      photoBox.onclick = null;
    }
  }
  // 3. Issue Information Card
  const catBadge = $("#detail-category-badge");
  if (catBadge) catBadge.textContent = categoryLabels[report.category] || report.category;
  const catDesc = $("#detail-category-desc");
  if (catDesc) catDesc.textContent = categoryLabels[report.category] || report.category;
  const titleEl = $("#detail-title");
  if (titleEl) titleEl.textContent = report.title;
  const descEl = $("#detail-description");
  if (descEl) descEl.textContent = report.description;

  const miniStatus = $("#detail-mini-status");
  if (miniStatus) miniStatus.innerHTML = badge(report.status, "status");
  const miniPriority = $("#detail-mini-priority");
  if (miniPriority) miniPriority.innerHTML = badge(report.priority, "priority");
  const miniSeverity = $("#detail-mini-severity");
  if (miniSeverity) miniSeverity.innerHTML = report.severity ? badge(report.severity, "priority") : '<span class="badge badge-neutral">Not assessed</span>';

  // 4. Metadata Card
  const reporterName = $("#detail-reporter-name");
  if (reporterName) reporterName.textContent = report.reporter_name || "Resident";
  const reporterEmail = $("#detail-reporter-email");
  if (reporterEmail) reporterEmail.textContent = report.reporter_email || "Not provided";
  const reportId = $("#detail-report-id");
  if (reportId) reportId.textContent = report.id;
  const updatedAt = $("#detail-updated-at");
  if (updatedAt) updatedAt.textContent = formatDate(report.updated_at || report.created_at);

  // 5. Location & Interactive Map
  const coords = extractCoordinates(report.location);
  const defaultLat = 21.157006;
  const defaultLng = 79.152908;
  const lat = coords ? coords.lat : defaultLat;
  const lng = coords ? coords.lng : defaultLng;

  const latEl = $("#detail-lat");
  const lngEl = $("#detail-lng");
  const addrEl = $("#detail-address-text");
  const gmapsLink = $("#detail-gmaps-link");

  if (latEl) latEl.textContent = coords ? lat.toFixed(6) : "Unavailable";
  if (lngEl) lngEl.textContent = coords ? lng.toFixed(6) : "Unavailable";
  if (addrEl) addrEl.textContent = report.location ? `Reported near ${report.location}` : "Coordinates only";
  if (gmapsLink) {
    gmapsLink.href = coords
      ? `https://www.google.com/maps?q=${lat},${lng}`
      : `https://www.google.com/maps?q=${encodeURIComponent(report.location || "")}`;
  }

  initAdminDetailMap(lat, lng, report);

  // 6. Field Assignment Card
  const assignedTo = $("#detail-assigned-to");
  if (assignedTo) assignedTo.textContent = report.assigned_to || "Pending assignment";
  const assignedDate = $("#detail-assigned-date");
  if (assignedDate) assignedDate.textContent = report.assigned_to ? formatDate(report.updated_at || report.created_at) : "Not yet assigned";

  // 7. Citizen Reward Card
  const isResolved = report.status === "RESOLVED";
  const alreadyRewarded = isResolved && Boolean(report.reward_points);
  const activeSeverity = report.severity || report.priority || "";
  const activePoints = alreadyRewarded
    ? report.reward_points
    : activeSeverity ? getPointsForSeverity(activeSeverity, report.priority) : null;

  const pointsEl = $("#detail-reward-points");
  const tierEl = $("#detail-reward-tier");
  const pillEl = $("#detail-reward-status-pill");
  const noteEl = $("#detail-reward-note");

  if (alreadyRewarded) {
    if (pointsEl) pointsEl.textContent = `⭐ +${activePoints} Points Awarded`;
    if (tierEl) tierEl.textContent = `${activeSeverity} Severity`;
    if (pillEl) {
      pillEl.className = "tier-badge";
      pillEl.style.background = "rgba(31,200,178,0.2)";
      pillEl.style.color = "#0f766e";
      pillEl.textContent = "Resolved & Credited";
    }
    if (noteEl) noteEl.textContent = "Reward points have been successfully credited to the citizen's wallet.";
  } else if (activeSeverity) {
    if (pointsEl) pointsEl.textContent = `⭐ ${activePoints} Points`;
    if (tierEl) tierEl.textContent = `${activeSeverity} Severity`;
    if (pillEl) {
      pillEl.className = `tier-badge tier-${activeSeverity.toLowerCase()}`;
      pillEl.style.background = "";
      pillEl.style.color = "";
      pillEl.textContent = "Auto-awarded";
    }
    if (noteEl) noteEl.textContent = "Automatically awarded when the issue is marked Resolved.";
  } else {
    if (pointsEl) pointsEl.textContent = "Pending severity";
    if (tierEl) tierEl.textContent = "Assess severity below";
    if (pillEl) {
      pillEl.className = "tier-badge";
      pillEl.style.background = "#f1f5f9";
      pillEl.style.color = "#64748b";
      pillEl.textContent = "Not Assessed";
    }
    if (noteEl) noteEl.textContent = "Select a severity level in actions to configure citizen reward.";
  }

  // 8. Authority Actions Form
  const statusSelect = $("#detail-select-status");
  if (statusSelect) statusSelect.value = report.status || "SUBMITTED";
  const prioritySelect = $("#detail-select-priority");
  if (prioritySelect) prioritySelect.value = report.priority || "";
  const categorySelect = $("#detail-select-category");
  if (categorySelect) categorySelect.value = report.category || "GARBAGE";
  const severitySelect = $("#detail-select-severity");
  if (severitySelect) severitySelect.value = report.severity || "";
  const assignedInput = $("#detail-input-assigned");
  if (assignedInput) assignedInput.value = report.assigned_to || "";
  const messageInput = $("#detail-textarea-message");
  if (messageInput) messageInput.value = "";

  const livePreview = () => {
    if (report.status === "RESOLVED" && report.reward_points) return;
    const sev = severitySelect?.value || prioritySelect?.value || "";
    if (sev) {
      const pts = getPointsForSeverity(sev);
      if (pointsEl) pointsEl.textContent = `⭐ ${pts} Points`;
      if (tierEl) tierEl.textContent = `${sev} Severity`;
      if (pillEl) {
        pillEl.className = `tier-badge tier-${sev.toLowerCase()}`;
        pillEl.style.background = "";
        pillEl.style.color = "";
        pillEl.textContent = "Auto-awarded";
      }
      if (noteEl) noteEl.textContent = "Automatically awarded when the issue is marked Resolved.";
    } else {
      if (pointsEl) pointsEl.textContent = "Pending severity";
      if (tierEl) tierEl.textContent = "Assess severity below";
      if (pillEl) {
        pillEl.className = "tier-badge";
        pillEl.style.background = "#f1f5f9";
        pillEl.style.color = "#64748b";
        pillEl.textContent = "Not Assessed";
      }
      if (noteEl) noteEl.textContent = "Select a severity level to configure citizen reward.";
    }
  };
  if (severitySelect) severitySelect.onchange = livePreview;
  if (prioritySelect) prioritySelect.onchange = livePreview;

  // Authority-only decision summary, warning retry, and appeal review.
  const falseCaseValue = report.false_report_case || report.false_report_cases;
  const falseCase = Array.isArray(falseCaseValue) ? falseCaseValue[0] : falseCaseValue;
  const statusControl = $("#detail-select-status");
  if (statusControl) {
    const rejectOption = statusControl.querySelector('option[value="REJECTED"]');
    if (rejectOption) rejectOption.disabled = Boolean(falseCase) && report.status !== "REJECTED";
  }
  const decisionSummary = $("#false-report-decision-summary");
  const appealReview = $("#false-report-appeal-review");
  const appealMessage = $("#false-report-appeal-message");
  const accountCount = $("#false-report-account-count");
  const confirmedCount = Number(report.false_report_account_count ?? falseCase?.case_number ?? 0);
  if (accountCount) {
    accountCount.hidden = false;
    accountCount.textContent = report.user_id
      ? `${t("Confirmed false reports on this account")}: ${confirmedCount}. ${t("Cases 1–2 receive warning emails; cases 3–5 lose points; case 6 and later blocks report submission.")}`
      : t("No authenticated citizen account is linked to this report; account-level repeat sanctions cannot be applied.");
  }
  const falseLabels = { WARNING: "Cases 1–2 · warning", POINT_DEDUCTION: "Cases 3–5 · point deduction", ACCOUNT_BLOCK: "More than 5 cases · account blocked", PENALTY_REVIEW: "Legacy penalty review", PENALTY_NOTICE: "Legacy penalty notice", OVERTURNED: "Decision overturned" };
  if (falseCase) {
    if (decisionSummary) {
      const showDecisionSummary = report.status !== "REJECTED";
      decisionSummary.hidden = !showDecisionSummary;
      if (showDecisionSummary) {
        const canRetryWarning = falseCase.action === "WARNING" && falseCase.warning_email_status !== "SENT" && falseCase.citizen_user_id;
        const warningStatus = falseCase.action === "WARNING" ? `<p>Warning email: ${escapeHtml((falseCase.warning_email_status || "PENDING").replaceAll("_", " "))}${falseCase.warning_email_error ? ` · ${escapeHtml(falseCase.warning_email_error)}` : ""}</p>${canRetryWarning ? `<button type="button" class="button button-outline" data-warning-email-retry="${report.id}">Send or retry warning email</button>` : ""}` : "";
        const deductionSummary = falseCase.action === "POINT_DEDUCTION" ? Number(falseCase.points_deducted || 0) ? `<p>${Number(falseCase.points_deducted)} ${t("points deducted from the citizen wallet.")}</p>` : `<p>${t("No wallet points were available to deduct.")}</p>` : "";
        decisionSummary.innerHTML = `<p><strong>${t("Authority decision")}: ${escapeHtml(t(falseLabels[falseCase.action] || falseCase.action))} · ${t("Case")} ${Number(falseCase.case_number || 0)}</strong></p><p><strong>${t("Authority reason")}:</strong> ${escapeHtml(falseCase.reason || "")}</p>${warningStatus}${deductionSummary}${falseCase.action === "ACCOUNT_BLOCK" ? `<p>${t("Blocked from submitting new reports; sign-in remains available for review and appeals.")}</p>` : ""}`;
      } else {
        decisionSummary.innerHTML = "";
      }
    }
    if (appealReview) {
      appealReview.hidden = falseCase.appeal_status !== "PENDING";
      if (appealMessage) appealMessage.textContent = falseCase.appeal_message || "";
    }
  } else {
    if (decisionSummary) { decisionSummary.hidden = true; decisionSummary.textContent = ""; }
    if (appealReview) appealReview.hidden = true;
  }

  // 9. Authority Updates Timeline
  const timelineContainer = $("#detail-timeline-container");
  const updates = report.report_updates || [];
  const countEl = $("#detail-updates-count");
  if (countEl) countEl.textContent = `${updates.length} Remark${updates.length === 1 ? "" : "s"}`;

  if (timelineContainer) {
    if (updates.length) {
      timelineContainer.innerHTML = updates.map((u) => `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-meta">
            <strong class="timeline-author">${escapeHtml(u.status ? statusLabels[u.status] || u.status : u.created_by)}</strong>
            <span class="timeline-date">${formatDate(u.created_at)}</span>
          </div>
          <div class="timeline-content">${escapeHtml(u.message)}</div>
        </div>
      `).join("");
    } else {
      timelineContainer.innerHTML = `<div class="timeline-empty">No authority updates have been posted yet.</div>`;
    }
  }
}

function requestFalseReportConfirmation(report) {
  const dialog = $("#false-report-confirm-dialog");
  const form = $("#false-report-confirm-form");
  if (!dialog || !form || typeof dialog.showModal !== "function") return Promise.resolve(null);
  form.reset();
  $("#false-report-confirm-reference").textContent = `Report ${report.reference_no || report.id}`;
  $("#false-report-confirm-account").textContent = report.user_id
    ? `Linked citizen account: ${report.reporter_email || "authenticated account"}`
    : "No authenticated citizen account is linked. This decision will not add an account-level repeat sanction.";
  $("#false-report-confirm-status").hidden = true;
  $$('[data-false-error]').forEach((node) => { node.hidden = true; });
  dialog.showModal();
  return new Promise((resolve) => { resolveFalseReportDialog = resolve; });
}

function finishFalseReportConfirmation(value) {
  const dialog = $("#false-report-confirm-dialog");
  if (!resolveFalseReportDialog) return;
  const resolve = resolveFalseReportDialog;
  resolveFalseReportDialog = null;
  if (dialog?.open) dialog.close();
  resolve(value);
}

async function saveAdminDetailUpdate(event) {
  event.preventDefault();
  const report = state.activeAdminReport;
  if (!report) return;
  const button = $("#detail-submit-btn");
  const requestedStatus = $("#detail-select-status").value;
  let falseReportDecision;
  if (button) {
    button.disabled = true;
    button.textContent = requestedStatus === "REJECTED" ? "Reviewing rejection…" : "Saving…";
  }

  try {
    const existingCase = report.false_report_case || report.false_report_cases?.[0];
    if (requestedStatus === "REJECTED" && !existingCase) {
      falseReportDecision = await requestFalseReportConfirmation(report);
      if (!falseReportDecision) {
        $("#detail-select-status").value = report.status || "SUBMITTED";
        return;
      }
    }
    const data = await api(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: $("#detail-select-status").value,
        category: $("#detail-select-category").value,
        priority: $("#detail-select-priority").value || undefined,
        severity: $("#detail-select-severity").value || undefined,
        assignedTo: $("#detail-input-assigned").value,
        message: $("#detail-textarea-message").value,
        falseReportDecision
      })
    });

    if (data.decision) {
      toast(`Report ${report.reference_no}: false-report case ${data.decision.case_number} recorded — ${data.decision.action.replaceAll("_", " ")}.`, "success");
    } else {
      toast("✓ Update posted successfully", "success");
    }
    if (data.reward?.awarded) {
      toast(`⭐ +${data.reward.points} reward points credited to citizen.`, "success");
    }

    state.activeAdminReport = data.report;
    if (state.adminReports) {
      const idx = state.adminReports.findIndex((r) => r.id === report.id);
      if (idx !== -1) state.adminReports[idx] = data.report;
    }

    renderAdminDetail(data.report);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2.5"/></svg> Save Update`;
    }
  }
}

async function reviewFalseReportAppeal(reportId, accept) {
  const note = $("#false-report-review-note")?.value.trim() || "";
  if (note.length < 5) { toast("Add a review note of at least 5 characters.", "error"); return; }
  try {
    const result = await api(`/api/reports/${reportId}/false-report-appeal/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept, reviewNote: note })
    });
    toast(accept ? "Appeal accepted; the decision was reversed." : "Appeal reviewed and upheld.", "success");
    state.activeAdminReport = result.report;
    const index = state.adminReports?.findIndex((item) => item.id === reportId) ?? -1;
    if (index >= 0) state.adminReports[index] = result.report;
    renderAdminDetail(result.report);
    await loadAdminReports();
  } catch (error) { toast(error.message, "error"); }
}

async function retryFalseReportWarning(reportId) {
  const button = $$('[data-warning-email-retry]').find((item) => item.dataset.warningEmailRetry === reportId);
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/reports/${reportId}/false-report-warning-email/retry`, { method: "POST" });
    state.activeAdminReport = result.report;
    const index = state.adminReports?.findIndex((item) => item.id === reportId) ?? -1;
    if (index >= 0) state.adminReports[index] = result.report;
    renderAdminDetail(result.report);
    const sent = result.report.false_report_case?.warning_email_status === "SENT" || result.report.false_report_cases?.[0]?.warning_email_status === "SENT";
    if (sent) toast("Warning email sent.", "success");
  } catch (error) {
    // Email delivery is best effort; keep its transport errors out of the UI.
    if (button) button.disabled = false;
  }
}

async function submitCitizenFalseReportAppeal(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const reportId = form.dataset.falseReportAppeal;
  const message = new FormData(form).get("message");
  const button = form.querySelector("button[type=submit]");
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/reports/${reportId}/false-report-appeal`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message })
    });
    if (result.decision?.appeal_status === "ACCEPTED" && state.currentUser?.accountBlocked) {
      const session = await api("/api/auth/session");
      state.currentUser = session.user;
      sessionStorage.setItem("urbanAidUser", JSON.stringify({ role: session.user.role, name: session.user.name || "", email: session.user.email || "", accountBlocked: session.user.accountBlocked === true }));
      updateNavForUser();
    }
    toast("Appeal submitted for authority review.", "success");
    await loadMyReports();
  } catch (error) {
    toast(error.message, "error");
    if (button) button.disabled = false;
  }
}

function openLightbox(src, caption) {
  const modal = $("#image-lightbox");
  const img = $("#lightbox-img");
  const cap = $("#lightbox-caption");
  if (!modal || !img) return;
  state.lightboxReturnFocus = document.activeElement;
  img.src = src;
  if (cap) cap.textContent = caption || "";
  modal.hidden = false;
  modal.querySelector(".lightbox-close")?.focus();
}

function closeLightbox() {
  const modal = $("#image-lightbox");
  if (modal && !modal.hidden) {
    modal.hidden = true;
    state.lightboxReturnFocus?.focus?.();
    state.lightboxReturnFocus = null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateNavForUser();
  showViewFromHash();
  window.addEventListener("hashchange", showViewFromHash);
  window.setInterval(refreshProfileFalseReportCount, 30000);

  // Set default initial auth mode
  setAuthMode("citizen");

  // Portal selection buttons
  const authRoleButtons = $$("[data-auth-role]");
  authRoleButtons.forEach((button, index) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authRole));
    button.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? authRoleButtons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + authRoleButtons.length) % authRoleButtons.length;
      authRoleButtons[nextIndex].focus();
      setAuthMode(authRoleButtons[nextIndex].dataset.authRole);
    });
  });

  $("#login-form").addEventListener("submit", handlePortalLogin);
  $("#password-toggle").addEventListener("click", () => {
    const input = $("#auth-password");
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    $("#password-toggle").textContent = visible ? "Show" : "Hide";
    $("#password-toggle").setAttribute("aria-label", visible ? "Show password" : "Hide password");
    $("#password-toggle").setAttribute("aria-pressed", String(!visible));
  });

  $("#forgot-password").addEventListener("click", handleForgotPassword);
  $("#nav-signout")?.addEventListener("click", handleLogout);
  $("#profile-signout")?.addEventListener("click", handleLogout);
  $("#profile-security-signout")?.addEventListener("click", handleLogout);
  $("#profile-password-reset")?.addEventListener("click", sendProfilePasswordReset);
  $("#profile-edit-open")?.addEventListener("click", () => $("#profile-edit-dialog").showModal());
  $("#profile-edit-form")?.addEventListener("submit", saveProfile);
  $("#profile-citizen-content")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-profile-edit]")) $("#profile-edit-dialog").showModal();
    if (event.target.closest("#profile-retry")) loadProfile();
  });
  $("#profile-data-state")?.addEventListener("click", (event) => { if (event.target.closest("#profile-retry")) loadProfile(); });
  $$("[data-profile-edit-close]").forEach((button) => button.addEventListener("click", () => $("#profile-edit-dialog").close()));
  window.addEventListener("urban-aid-language-change", () => {
    const language = window.urbanAidI18n?.language === "hi" ? "Hindi" : "English";
    const field = $("#profile-detail-language");
    if (field) field.textContent = language;
    $$("#report-modal [data-report-date]").forEach((date) => {
      if (date.dateTime && !Number.isNaN(Date.parse(date.dateTime))) date.textContent = formatDate(date.dateTime);
    });
  });
  $$("[data-oauth-provider]").forEach((button) => button.addEventListener("click", () => beginOAuth(button.dataset.oauthProvider)));
  $("#auth-disclaimer").addEventListener("click", (event) => {
    if (event.target.closest("#auth-mode-toggle")) setAuthFormMode(state.authFormMode === "signup" ? "signin" : "signup");
  });

  $(".menu-button").addEventListener("click", () => {
    const menu = $(".main-nav");
    const expanded = menu.classList.toggle("open");
    $(".menu-button").setAttribute("aria-expanded", String(expanded));
    $(".menu-button").setAttribute("aria-label", expanded ? "Close navigation" : "Open navigation");
  });

  $("#report-form").addEventListener("submit", submitReport);
  $("#category").addEventListener("change", updateReportCategoryGuidance);
  updateReportCategoryGuidance();
  $("#image").addEventListener("change", (event) => {
    const file = event.target.files[0];
    previewReportImage(file);
  });
  $("#remove-report-image").addEventListener("click", () => {
    clearReportImagePreview(true);
    setError("image", "");
  });

  $("#location-button").addEventListener("click", () => {
    if (!navigator.geolocation) {
      toast("Location services are unavailable in this browser.", "error");
      return;
    }
    const button = $("#location-button");
    button.textContent = t("Locating…");
    button.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        $("#location").value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
        button.textContent = t("Location added");
        button.disabled = false;
        setError("location", "");
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "Location permission was denied. Enter a street, landmark, or coordinates instead."
          : error.code === error.TIMEOUT
            ? "Location lookup timed out. Try again or enter the location manually."
            : "We could not access your location. Enter a street, landmark, or coordinates instead.";
        toast(t(message), "error");
        button.textContent = t("Use my location");
        button.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });

  // Reference track form
  $("#track-form")?.addEventListener("submit", handleTrackSubmit);

  // Quick track search button in navbar
  $("#nav-search-btn")?.addEventListener("click", () => {
    location.hash = "track";
    setTimeout(() => {
      const input = $("#track-input");
      if (input) {
        input.focus();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  });

  // Hero play button info walkthrough
  $("#hero-play-btn")?.addEventListener("click", () => {
    toast("✨ How Urban Aid Report Works: 1) Spot garbage buildup or a drainage problem, 2) Submit the location and a photo, 3) Municipal teams respond and post updates, 4) Earn verified reward points when the issue is resolved!", "info");
  });

  // Authority desk toolbar listeners
  ["#admin-search", "#admin-status", "#admin-category", "#admin-priority"].forEach((selector) => {
    const el = $(selector);
    if (el) el.addEventListener(selector === "#admin-search" ? "input" : "change", debounce(loadAdminReports, 300));
  });

  document.addEventListener("click", (event) => {
    const reportPhoto = event.target.closest("[data-report-photo]");
    if (reportPhoto) {
      openLightbox(reportPhoto.dataset.reportPhoto, state.activeModalReport?.title || t("Photo evidence"));
      return;
    }
    const retryWarning = event.target.closest("[data-warning-email-retry]");
    if (retryWarning) { retryFalseReportWarning(retryWarning.dataset.warningEmailRetry); return; }
    const appealDecision = event.target.closest("[data-false-appeal-review]");
    if (appealDecision && state.activeAdminReport) {
      reviewFalseReportAppeal(state.activeAdminReport.id, appealDecision.dataset.falseAppealReview === "accept");
      return;
    }
    const button = event.target.closest("[data-report-id]");
    if (button) {
      const fromAdmin = button.closest("#admin-list") !== null;
      if (fromAdmin && state.currentUser?.role === "authority") {
        openAdminReportDetail(button.dataset.reportId);
      } else {
        getReportForModal(button.dataset.reportId, fromAdmin);
      }
    }
    if (event.target.closest("[data-close-modal]")) closeReportModal();
    if (event.target.closest("[data-close-lightbox]")) closeLightbox();
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id === "modal-update") saveAdminUpdate(event);
    if (event.target.id === "admin-detail-form") saveAdminDetailUpdate(event);
    if (event.target.matches("[data-false-report-appeal]")) submitCitizenFalseReportAppeal(event);
  });

  $("#false-report-confirm-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const reason = $("#false-report-confirm-reason").value.trim();
    const evidenceSummary = $("#false-report-confirm-evidence").value.trim();
    const confirmedByAuthority = $("#false-report-confirm-check").checked;
    const errors = { reason: reason.length < 10, evidence: evidenceSummary.length < 10, confirmation: !confirmedByAuthority };
    Object.entries(errors).forEach(([key, invalid]) => {
      const node = $(`[data-false-error="${key}"]`);
      if (node) node.hidden = !invalid;
    });
    if (Object.values(errors).some(Boolean)) return;
    finishFalseReportConfirmation({ reason, evidenceSummary, confirmedByAuthority });
  });
  $("#false-report-cancel")?.addEventListener("click", () => finishFalseReportConfirmation(null));
  $("#false-report-confirm-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    finishFalseReportConfirmation(null);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!$("#image-lightbox").hidden) {
        closeLightbox();
        return;
      }
      closeReportModal();
      return;
    }
    const modal = $("#report-modal");
    if (!$("#image-lightbox").hidden) return;
    if (event.key === "Tab" && modal && !modal.hidden) {
      const focusable = [...modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  void restoreAuthentication();
});

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
