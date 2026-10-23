import { confirmFalseReport, createReport, getFalseReportCount, getReport, listReports, reviewFalseReportAppeal, submitFalseReportAppeal, updateFalseReportWarningEmail, updateReport } from "../services/reportService.js";
import { accessToken } from "./authController.js";
import { blockMockCitizenAccount, getUserFromAccessToken } from "../services/authService.js";
import { sendAuthorityReportAction, sendFalseReportWarning } from "../services/emailService.js";
import { config } from "../config/env.js";
import { requireSupabase } from "../config/supabase.js";

const categories = new Set(["GARBAGE", "DRAINAGE"]);
const statuses = new Set(["SUBMITTED", "UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "REJECTED"]);
const priorities = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const clean = (value, max) => String(value || "").trim().slice(0, max);

function validateReport(body) {
  const report = { title: clean(body.title, 120), category: clean(body.category, 40), description: clean(body.description, 2000), location: clean(body.location, 300), additionalInfo: clean(body.additionalInfo, 1000), reporterName: clean(body.reporterName, 100), reporterEmail: clean(body.reporterEmail, 254).toLowerCase(), reporterPhone: clean(body.reporterPhone, 30) };
  const errors = {};
  if (report.title.length < 4) errors.title = "Enter a clear title of at least 4 characters.";
  if (!categories.has(report.category)) errors.category = "Choose a valid issue category.";
  if (report.description.length < 10) errors.description = "Add at least 10 characters describing the problem.";
  if (report.location.length < 3) errors.location = "Enter an address, landmark, or precise location.";
  if (report.reporterName.length < 2) errors.reporterName = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(report.reporterEmail)) errors.reporterEmail = "Enter a valid email address.";
  return { report, errors };
}

export async function submitReport(req, res) {
  const currentUser = await getUserFromAccessToken(accessToken(req));
  if (!currentUser) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in to submit a report." });
  if (currentUser.app_metadata?.role === "authority") return res.status(403).json({ error: "FORBIDDEN", message: "Authority accounts cannot submit citizen reports." });
  if (currentUser?.app_metadata?.account_blocked === true) return res.status(403).json({ error: "ACCOUNT_BLOCKED", message: "This account is blocked from submitting reports. You can still view your report history and submit an appeal." });
  const { report, errors } = validateReport(req.body);
  if (Object.keys(errors).length) return res.status(422).json({ error: "VALIDATION_ERROR", message: "Review the highlighted fields.", fields: errors });
  report.userId = currentUser.id;
  if (currentUser.email) report.reporterEmail = currentUser.email;
  return res.status(201).json({ report: await createReport(report, req.file) });
}

export async function getReports(req, res) {
  const admin = Boolean(req.isAdmin);
  let reporterEmail = null;
  if (!admin) {
    const user = await getUserFromAccessToken(accessToken(req));
    if (!user) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in to view your report history." });
    if (user.app_metadata?.role === "authority") return res.status(403).json({ error: "FORBIDDEN", message: "Authority accounts use the Operations Desk." });
    if (!user.email) return res.status(409).json({ error: "ACCOUNT_EMAIL_REQUIRED", message: "Add an email address to your account to view your report history." });
    const requestedEmail = clean(req.query.reporter_email, 254).toLowerCase();
    if (requestedEmail && requestedEmail !== String(user.email || "").toLowerCase()) return res.status(403).json({ error: "FORBIDDEN", message: "You can only view reports linked to your signed-in account." });
    reporterEmail = user.email;
  }
  const filters = { status: statuses.has(req.query.status) ? req.query.status : null, category: categories.has(req.query.category) ? req.query.category : null, priority: priorities.has(req.query.priority) ? req.query.priority : null, reporterEmail, search: admin ? clean(req.query.search, 100) : null };
  return res.json({ reports: await listReports(filters, admin) });
}

export async function getMyReports(req, res) {
  const user = await getUserFromAccessToken(accessToken(req));
  if (!user) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in to view your reports." });
  if (user.app_metadata?.role === "authority") return res.status(403).json({ error: "FORBIDDEN", message: "Authority accounts use the Authority Desk." });
  const reports = await listReports({ userId: user.id }, false, true);
  const falseReportCount = await getFalseReportCount({ userId: user.id, email: user.email });
  let summary = {
    total: reports.length,
    resolved: reports.filter((report) => report.status === "RESOLVED").length,
    active: reports.filter((report) => ["SUBMITTED", "UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS"].includes(report.status)).length,
  };
  if (config.isSupabaseConfigured) {
    const client = requireSupabase();
    const filters = [null, "RESOLVED", ["SUBMITTED", "UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS"]];
    const counts = await Promise.all(filters.map((status) => {
      let query = client.from("reports").select("id", { count: "exact", head: true }).eq("user_id", user.id);
      if (typeof status === "string") query = query.eq("status", status);
      else if (Array.isArray(status)) query = query.in("status", status);
      return query;
    }));
    if (counts.some(({ error }) => error)) return res.status(502).json({ error: "PROFILE_STATS_FAILED", message: "Unable to load report totals." });
    summary = { total: counts[0].count || 0, resolved: counts[1].count || 0, active: counts[2].count || 0 };
  }
  return res.json({ reports, falseReportCount, summary });
}

export async function getOneReport(req, res) {
  const user = await getUserFromAccessToken(accessToken(req));
  const isAuthority = user?.app_metadata?.role === "authority";
  const report = await getReport(req.params.id, isAuthority, isAuthority);
  if (isAuthority && report.user_id) report.false_report_account_count = await getFalseReportCount({ userId: report.user_id, email: report.reporter_email });
  return res.json({ report });
}

export async function patchReport(req, res) {
  const changes = { status: statuses.has(req.body.status) ? req.body.status : undefined, category: categories.has(req.body.category) ? req.body.category : undefined, priority: priorities.has(req.body.priority) ? req.body.priority : undefined, severity: priorities.has(req.body.severity) ? req.body.severity : undefined, assigned_to: clean(req.body.assignedTo, 100) || undefined, message: clean(req.body.message, 500) };
  if (req.body.category && !changes.category) return res.status(422).json({ error: "INVALID_CATEGORY", message: "Choose Garbage or Drainage as the final category." });
  if (req.body.severity && !changes.severity) return res.status(422).json({ error: "INVALID_SEVERITY", message: "Choose a valid final severity." });
  const authorityName = clean(req.user?.user_metadata?.full_name || req.user?.email, 100) || "Municipal Authority";
  const result = await updateReport(req.params.id, changes, authorityName);
  const details = [];
  if (changes.message) details.push(changes.message);
  if (changes.assigned_to) details.push(`Assigned to: ${changes.assigned_to}`);
  if (changes.priority) details.push(`Priority: ${changes.priority}`);
  if (changes.severity) details.push(`Severity: ${changes.severity}`);
  if (changes.category) details.push(`Final category: ${changes.category}`);
  const emailResult = await sendAuthorityReportAction({ to: result.reporter_email, name: result.reporter_name, report: result, action: `Report updated${changes.status ? ` to ${changes.status.replaceAll("_", " ")}` : ""}`, details });
  return res.json({ report: result, reward: result.reward_result || null, notification: { status: emailResult.status } });
}

export async function markFalseReport(req, res) {
  if (req.body.confirmedByAuthority !== true) return res.status(422).json({ error: "AUTHORITY_CONFIRMATION_REQUIRED", message: "Confirm that you reviewed evidence of intentional false reporting." });
  const result = await confirmFalseReport({
    reportId: req.params.id,
    reason: clean(req.body.reason, 500),
    evidenceSummary: clean(req.body.evidenceSummary, 1000),
    authorityUser: req.user,
    authorityName: clean(req.user?.user_metadata?.full_name || req.user?.email, 100) || "Municipal Authority",
  });
  const decision = result.decision;
  if (decision.action === "WARNING") {
    const emailResult = decision.citizen_user_id
      ? await sendFalseReportWarning({ to: decision.reporter_email, name: result.report.reporter_name, caseNumber: decision.case_number, reportReference: result.report.reference_no, reason: decision.reason })
      : { status: "SKIPPED_NO_ACCOUNT", error: "No authenticated citizen account is linked to this report." };
    await updateFalseReportWarningEmail(req.params.id, emailResult);
    decision.warning_email_status = emailResult.status;
    decision.warning_email_attempted_at = new Date().toISOString();
    decision.warning_email_error = emailResult.error || null;
    const nested = result.report.false_report_case || result.report.false_report_cases?.[0];
    if (nested) Object.assign(nested, { warning_email_status: emailResult.status, warning_email_attempted_at: decision.warning_email_attempted_at, warning_email_error: decision.warning_email_error });
  } else {
    const emailResult = await sendAuthorityReportAction({
      to: decision.reporter_email || result.report.reporter_email,
      name: result.report.reporter_name,
      report: result.report,
      action: `Confirmed false-report decision: ${decision.action}`,
      details: [`False-report case ${decision.case_number}`, `Authority reason: ${decision.reason}`, decision.evidence_summary ? `Evidence reviewed: ${decision.evidence_summary}` : null, decision.points_deducted ? `${decision.points_deducted} wallet points deducted` : null],
    });
    decision.action_email_status = emailResult.status;
  }
  if (decision.action === "ACCOUNT_BLOCK") blockMockCitizenAccount(decision.citizen_user_id);
  result.report.false_report_account_count = Number(decision.case_number || 0);
  return res.json({ decision: result.decision, report: result.report });
}

export async function retryFalseReportWarningEmail(req, res) {
  const report = await getReport(req.params.id, true, true);
  const nested = report.false_report_case || report.false_report_cases;
  const decision = Array.isArray(nested) ? nested[0] : nested;
  if (!decision || decision.action !== "WARNING") return res.status(409).json({ error: "WARNING_EMAIL_NOT_APPLICABLE", message: "This report does not have a warning email to send." });
  if (!decision.citizen_user_id || !decision.reporter_email) return res.status(409).json({ error: "WARNING_EMAIL_NO_ACCOUNT", message: "No authenticated citizen account is linked to this warning." });
  if (decision.warning_email_status === "SENT") return res.status(409).json({ error: "WARNING_EMAIL_ALREADY_SENT", message: "The warning email was already delivered." });
  const result = await sendFalseReportWarning({ to: decision.reporter_email, name: report.reporter_name, caseNumber: decision.case_number, reportReference: report.reference_no, reason: decision.reason });
  await updateFalseReportWarningEmail(req.params.id, result);
  Object.assign(decision, { warning_email_status: result.status, warning_email_attempted_at: new Date().toISOString(), warning_email_error: result.error || null, warning_email_provider_id: result.providerId || null });
  report.false_report_account_count = Number(decision.case_number || 0);
  return res.json({ report });
}

export async function appealFalseReport(req, res) {
  const user = await getUserFromAccessToken(accessToken(req));
  if (!user) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in to appeal this decision." });
  if (user.app_metadata?.role === "authority") return res.status(403).json({ error: "FORBIDDEN", message: "Only the reporting citizen can appeal." });
  const result = await submitFalseReportAppeal({ reportId: req.params.id, user, message: clean(req.body.message, 1000) });
  return res.json({ decision: result.decision, report: result.report });
}

export async function reviewFalseAppeal(req, res) {
  const result = await reviewFalseReportAppeal({
    reportId: req.params.id,
    accept: req.body.accept === true,
    reviewNote: clean(req.body.reviewNote, 500),
    authorityUser: req.user,
    authorityName: clean(req.user?.user_metadata?.full_name || req.user?.email, 100) || "Municipal Authority",
  });
  if (result.report.user_id) result.report.false_report_account_count = await getFalseReportCount({ userId: result.report.user_id, email: result.report.reporter_email });
  const emailResult = await sendAuthorityReportAction({
    to: result.report.reporter_email,
    name: result.report.reporter_name,
    report: result.report,
    action: result.decision.appeal_status === "ACCEPTED" ? "Your appeal was accepted" : "Your appeal was not accepted",
    details: [result.decision.appeal_review_note ? `Authority review: ${result.decision.appeal_review_note}` : null],
  });
  result.decision.appeal_email_status = emailResult.status;
  return res.json({ decision: result.decision, report: result.report });
}
