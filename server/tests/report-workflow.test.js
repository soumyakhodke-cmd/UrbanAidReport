import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { confirmFalseReport, getFalseReportCount, reviewFalseReportAppeal, submitFalseReportAppeal, updateReport, mockReports } from "../services/reportService.js";
import { awardReportResolution, calculateRewardPoints, getCitizenWalletData } from "../services/rewardService.js";
import { getUserFromAccessToken, signIn, syncMockCitizenAccountBlock } from "../services/authService.js";
import { getMyReports, getOneReport, patchReport, retryFalseReportWarningEmail, submitReport } from "../controllers/reportController.js";
import { config } from "../config/env.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { validateUploadedImage } from "../middleware/upload.js";
import { setSmtpSenderForTests } from "../services/emailService.js";

test("authority can manually classify and update a report", { skip: config.isSupabaseConfigured ? "mock workflow test requires local demo mode" : false }, async () => {
  const report = {
    id: `manual-test-${randomUUID()}`,
    reference_no: `UAR-TEST-${randomUUID()}`,
    title: "Manual authority review",
    category: "GARBAGE",
    status: "SUBMITTED",
    severity: null,
    priority: null,
    reporter_email: "citizen@example.test",
    created_at: new Date().toISOString(),
    report_updates: [],
  };
  mockReports.push(report);
  const updated = await updateReport(report.id, {
    category: "DRAINAGE",
    severity: "HIGH",
    status: "UNDER_REVIEW",
    message: "Authority assigned this issue for field inspection.",
  }, "Test authority");

  assert.equal(updated.category, "DRAINAGE");
  assert.equal(updated.severity, "HIGH");
  assert.equal(updated.status, "UNDER_REVIEW");
  assert.equal(updated.report_updates[0].created_by, "Test authority");
});

test("severity maps to fixed reward values and resolution awards cannot duplicate", { skip: config.isSupabaseConfigured ? "mock wallet test requires local demo mode" : false }, async () => {
  assert.equal(calculateRewardPoints("LOW"), 10);
  assert.equal(calculateRewardPoints("MEDIUM"), 25);
  assert.equal(calculateRewardPoints("HIGH"), 50);
  assert.equal(calculateRewardPoints("CRITICAL"), 100);
  const report = { id: `reward-test-${Date.now()}-${Math.random()}`, status: "RESOLVED", severity: "HIGH", user_id: `wallet-test-${Date.now()}`, reporter_email: "reward-test@example.com", reference_no: "UAR-TEST-REWARD", title: "Verified cleanup", category: "GARBAGE" };
  const first = await awardReportResolution({ report, severity: report.severity });
  const second = await awardReportResolution({ report, severity: report.severity });
  assert.equal(first.awarded, true);
  assert.equal(first.points, 50);
  assert.equal(second.awarded, false);
  assert.equal(second.reason, "ALREADY_REWARDED");
});

test("authority middleware refuses citizen sessions and accepts authority sessions", { skip: config.isSupabaseConfigured ? "authorization fixture requires local demo mode" : false }, async () => {
  const invoke = async (token) => {
    const result = { statusCode: 200, body: null, continued: false };
    const req = { headers: { authorization: `Bearer ${token}` }, get(name) { return name.toLowerCase() === "authorization" ? this.headers.authorization : null; } };
    const res = { status(code) { result.statusCode = code; return this; }, json(body) { result.body = body; return this; } };
    await requireAdmin(req, res, () => { result.continued = true; });
    return result;
  };
  const citizen = await invoke("mock-token-mock-citizen-01");
  const authority = await invoke("mock-token-mock-admin-01");
  assert.equal(citizen.statusCode, 403);
  assert.equal(citizen.continued, false);
  assert.equal(authority.continued, true);
  assert.equal(authority.statusCode, 200);
});

test("citizen reports are account-scoped and public report details hide contact data", { skip: config.isSupabaseConfigured ? "report ownership fixture requires local demo mode" : false }, async () => {
  const own = { id: randomUUID(), user_id: "mock-citizen-01", reference_no: `UAR-OWNER-${randomUUID()}`, title: "Citizen-owned report", category: "GARBAGE", status: "SUBMITTED", reporter_name: "Test Citizen", reporter_email: "citizen@example.com" };
  const other = { ...own, id: randomUUID(), user_id: "another-citizen-id", reference_no: `UAR-OTHER-${randomUUID()}` };
  mockReports.push(own, other);
  const responseFor = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const citizenReq = { headers: {}, params: {}, get(name) { return name.toLowerCase() === "authorization" ? "Bearer mock-token-mock-citizen-01" : null; } };
  const mineResponse = responseFor();
  await getMyReports(citizenReq, mineResponse);
  assert.ok(mineResponse.body.reports.some((report) => report.id === own.id));
  assert.equal(mineResponse.body.reports.some((report) => report.id === other.id), false);
  assert.equal(mineResponse.body.reports[0].user_id, undefined);
  assert.equal(mineResponse.body.reports[0].reporter_email, undefined);

  const publicReq = { headers: {}, params: { id: own.reference_no }, get() { return null; } };
  const publicResponse = responseFor();
  await getOneReport(publicReq, publicResponse);
  assert.equal(publicResponse.body.report.reporter_name, undefined);
  assert.equal(publicResponse.body.report.reporter_email, undefined);
  assert.equal(publicResponse.body.report.user_id, undefined);
});

test("upload middleware rejects a MIME type whose file signature does not match", () => {
  const req = { file: { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mimetype: "image/jpeg" } };
  let statusCode;
  let body;
  const res = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
  validateUploadedImage(req, res, () => assert.fail("invalid image should not pass"));
  assert.equal(statusCode, 400);
  assert.equal(body.error, "INVALID_IMAGE");
});

test("false-report cases follow warning, deduction, block, appeal reversal, and idempotency policy", { skip: config.isSupabaseConfigured ? "mock enforcement test requires local demo mode" : false }, async () => {
  const userId = "mock-citizen-01";
  const citizen = await getUserFromAccessToken(`mock-token-${userId}`);
  const wasBlocked = citizen.app_metadata?.account_blocked === true;
  syncMockCitizenAccountBlock(userId, false);
  const startingCount = await getFalseReportCount({ userId });
  assert.equal(startingCount, 0);

  const seed = { id: randomUUID(), status: "RESOLVED", severity: "HIGH", user_id: userId, reporter_email: citizen.email, reference_no: "UAR-SEED", title: "Seed wallet balance", category: "GARBAGE" };
  await awardReportResolution({ report: seed, severity: "HIGH" });
  const reports = Array.from({ length: 6 }, (_, index) => ({
    id: randomUUID(), user_id: userId, reporter_email: citizen.email, reporter_name: "Citizen User",
    reference_no: `UAR-FALSE-${randomUUID().slice(0, 8)}`, title: `False case ${index + 1}`, category: "GARBAGE",
    status: "SUBMITTED", severity: "LOW", created_at: new Date().toISOString(), report_updates: [],
  }));
  mockReports.push(...reports);

  try {
    const decisions = [];
    for (const [index, report] of reports.entries()) {
      const result = await confirmFalseReport({ reportId: report.id, reason: `Evidence-backed false case number ${index + 1}`, evidenceSummary: "Field inspection and timestamped location evidence reviewed." });
      decisions.push(result.decision);
    }
    assert.deepEqual(decisions.map((decision) => decision.action), ["WARNING", "WARNING", "POINT_DEDUCTION", "POINT_DEDUCTION", "POINT_DEDUCTION", "ACCOUNT_BLOCK"]);
    assert.deepEqual(decisions.slice(0, 2).map((decision) => decision.points_deducted), [0, 0]);
    assert.deepEqual(decisions.slice(2, 5).map((decision) => decision.points_deducted), [25, 25, 0]);
    assert.equal(await getFalseReportCount({ userId }), 6);

    const blockedUser = await getUserFromAccessToken(`mock-token-${userId}`);
    assert.equal(blockedUser.app_metadata.account_blocked, true);
    const blockedLogin = await signIn({ email: citizen.email, password: "password123", role: "citizen" });
    assert.equal(blockedLogin.user.accountBlocked, true);
    const authRequest = { headers: {}, body: {}, params: {}, get(name) { return name.toLowerCase() === "authorization" ? `Bearer mock-token-${userId}` : null; } };
    const blockedResponse = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await submitReport(authRequest, blockedResponse);
    assert.equal(blockedResponse.statusCode, 403);
    assert.equal(blockedResponse.body.error, "ACCOUNT_BLOCKED");
    const historyResponse = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await getMyReports(authRequest, historyResponse);
    assert.equal(historyResponse.statusCode, 200);
    assert.ok(reports.every((item) => historyResponse.body.reports.some((citizenReport) => citizenReport.id === item.id)));
    const walletAtBlock = await getCitizenWalletData({ id: userId, email: citizen.email }, reports);
    assert.equal(walletAtBlock.balance, 0);
    assert.equal(walletAtBlock.transactions.filter((transaction) => transaction.transaction_type === "FALSE_REPORT_DEDUCTION").length, 2);
    assert.ok(walletAtBlock.transactions.filter((transaction) => transaction.transaction_type === "FALSE_REPORT_DEDUCTION").every((transaction) => transaction.points < 0 && /case (3|4)/i.test(transaction.reason)));

    await assert.rejects(
      confirmFalseReport({ reportId: reports[0].id, reason: "Duplicate attempt with evidence", evidenceSummary: "Second decision attempt with the same evidence." }),
      { code: "FALSE_REPORT_ALREADY_DECIDED" },
    );
    assert.equal(await getFalseReportCount({ userId }), 6);

    await submitFalseReportAppeal({ reportId: reports[2].id, user: citizen, message: "The inspection evidence does not show that my report was intentionally false." });
    const reversed = await reviewFalseReportAppeal({ reportId: reports[2].id, accept: true, reviewNote: "The submitted evidence does not establish intentional false reporting." });
    assert.equal(reversed.report.status, "UNDER_REVIEW");
    assert.equal(reversed.decision.action, "OVERTURNED");
    assert.equal(await getFalseReportCount({ userId }), 5);
    assert.equal((await getUserFromAccessToken(`mock-token-${userId}`)).app_metadata.account_blocked, false);
    const walletAfterAppeal = await getCitizenWalletData({ id: userId, email: citizen.email }, reports);
    assert.equal(walletAfterAppeal.balance, 25);
    assert.equal(walletAfterAppeal.transactions.filter((transaction) => transaction.transaction_type === "FALSE_REPORT_REVERSAL").length, 1);
    await assert.rejects(
      reviewFalseReportAppeal({ reportId: reports[2].id, accept: true, reviewNote: "Attempting to restore points a second time." }),
      { code: "FALSE_REPORT_APPEAL_NOT_PENDING" },
    );

    await submitFalseReportAppeal({ reportId: reports[3].id, user: citizen, message: "I disagree with the evidence and request another authority review." });
    const upheld = await reviewFalseReportAppeal({ reportId: reports[3].id, accept: false, reviewNote: "The field inspection evidence supports the original decision." });
    assert.equal(upheld.decision.appeal_status, "REJECTED");
    assert.equal(await getFalseReportCount({ userId }), 5);
    assert.equal((await getCitizenWalletData({ id: userId, email: citizen.email }, reports)).balance, 25);
  } finally {
    mockReports.splice(mockReports.indexOf(reports[0]), reports.length);
    syncMockCitizenAccountBlock(userId, wasBlocked);
  }
});

test("Rejected status requires evidence and records a single false-report decision through PATCH", { skip: config.isSupabaseConfigured ? "mock rejection route test requires local demo mode" : false }, async () => {
  const report = { id: randomUUID(), user_id: "mock-citizen-01", reporter_email: "citizen@example.com", reporter_name: "Citizen User", reference_no: `UAR-REJECT-${randomUUID().slice(0, 8)}`, title: "Rejected status route", category: "DRAINAGE", status: "SUBMITTED", severity: "LOW", created_at: new Date().toISOString(), report_updates: [] };
  const secondReport = { ...report, id: randomUUID(), reference_no: `UAR-REJECT-${randomUUID().slice(0, 8)}`, title: "Second rejected status route" };
  mockReports.push(report, secondReport);
  const authority = { id: "mock-admin-01", email: "admin@city.gov", app_metadata: { role: "authority" }, user_metadata: { full_name: "Officer Verma" } };
  const previousHost = config.smtpHost;
  config.smtpHost = "";
  const invoke = async (body, reportId = report.id) => {
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await patchReport({ params: { id: reportId }, body, user: authority }, response);
    return response;
  };
  try {
    const missing = await invoke({ status: "REJECTED" });
    assert.equal(missing.statusCode, 422);
    assert.equal(missing.body.error, "FALSE_REPORT_CONFIRMATION_REQUIRED");
    const invalid = await invoke({ status: "REJECTED", falseReportDecision: { reason: "Not found", evidenceSummary: "No evidence", confirmedByAuthority: false } });
    assert.equal(invalid.statusCode, 422);

    const saved = await invoke({ status: "REJECTED", falseReportDecision: { reason: "Inspection confirmed the stated location was fabricated", evidenceSummary: "Officer inspected the named site and recorded the coordinates and time", confirmedByAuthority: true } });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.report.status, "REJECTED");
    assert.equal(saved.body.decision.case_number, 1);
    assert.equal(saved.body.decision.warning_email_status, "NOT_CONFIGURED");
    assert.equal(await getFalseReportCount({ userId: report.user_id }), 1);
    const second = await invoke({ status: "REJECTED", falseReportDecision: { reason: "Inspection confirmed the stated location was fabricated", evidenceSummary: "Officer inspected the named site and recorded the coordinates and time", confirmedByAuthority: true } }, secondReport.id);
    assert.equal(second.body.decision.case_number, 2);
    assert.equal(second.body.decision.warning_email_status, "NOT_CONFIGURED");
    assert.equal(second.body.decision.points_deducted, 0);
    assert.equal(await getFalseReportCount({ userId: report.user_id }), 2);

    await updateReport(report.id, { status: "UNDER_REVIEW" }, "Officer Verma");
    const repeated = await invoke({ status: "REJECTED", falseReportDecision: { reason: "Another attempt to add the same false case", evidenceSummary: "Repeated status change must not create another case", confirmedByAuthority: true } });
    assert.equal(repeated.statusCode, 409);
    assert.equal(await getFalseReportCount({ userId: report.user_id }), 2);
  } finally {
    config.smtpHost = previousHost;
    mockReports.splice(mockReports.indexOf(report), 2);
  }
});

test("the first two confirmed false-report cases automatically attempt warning emails", { skip: config.isSupabaseConfigured ? "mock email workflow test requires local demo mode" : false }, async () => {
  const userId = `email-test-${randomUUID()}`;
  const reports = Array.from({ length: 2 }, (_, index) => ({
    id: randomUUID(), user_id: userId, reporter_email: "citizen-email-test@example.test", reporter_name: "Test Citizen",
    reference_no: `UAR-EMAIL-${randomUUID().slice(0, 8)}`, title: `Email case ${index + 1}`, category: "GARBAGE",
    status: "SUBMITTED", severity: "LOW", created_at: new Date().toISOString(), report_updates: [],
  }));
  mockReports.push(...reports);
  const previous = { smtpHost: config.smtpHost, smtpPort: config.smtpPort, smtpUser: config.smtpUser, smtpAppPassword: config.smtpAppPassword, emailFrom: config.emailFrom };
  const deliveries = [];
  config.smtpHost = "smtp.gmail.com";
  config.smtpPort = 465;
  config.smtpUser = "sender@example.test";
  config.smtpAppPassword = "mock-only-secret";
  config.emailFrom = "Urban Aid <sender@example.test>";
  const restoreSender = setSmtpSenderForTests(async (message) => { deliveries.push(message); return { status: "SENT", providerId: "mock-accepted" }; });
  const authority = { id: "mock-admin-01", email: "admin@city.gov", app_metadata: { role: "authority" }, user_metadata: { full_name: "Test Authority" } };
  const invoke = async (report) => {
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await patchReport({ params: { id: report.id }, body: { status: "REJECTED", falseReportDecision: { reason: "The field inspection confirms this location was fabricated", evidenceSummary: "The officer visited the exact coordinates and reviewed dated location evidence", confirmedByAuthority: true } }, user: authority }, response);
    return response;
  };
  try {
    const first = await invoke(reports[0]);
    const second = await invoke(reports[1]);
    assert.equal(first.body.decision.case_number, 1);
    assert.equal(second.body.decision.case_number, 2);
    assert.equal(first.body.decision.warning_email_status, "SENT");
    assert.equal(second.body.decision.warning_email_status, "SENT");
    assert.equal(deliveries.length, 2);
    assert.ok(deliveries.every((message) => message.to === "citizen-email-test@example.test"));
    assert.match(deliveries[0].text, /case 1/);
    assert.match(deliveries[1].text, /case 2/);
  } finally {
    restoreSender();
    Object.assign(config, previous);
    mockReports.splice(mockReports.indexOf(reports[0]), reports.length);
  }
});

test("failed warning delivery can be retried without repeating the false case", { skip: config.isSupabaseConfigured ? "mock email retry test requires local demo mode" : false }, async () => {
  const userId = `retry-test-${randomUUID()}`;
  const report = { id: randomUUID(), user_id: userId, reporter_email: "retry-citizen@example.test", reporter_name: "Retry Citizen", reference_no: `UAR-RETRY-${randomUUID().slice(0, 8)}`, title: "Retry email test", category: "DRAINAGE", status: "SUBMITTED", severity: "LOW", created_at: new Date().toISOString(), report_updates: [] };
  mockReports.push(report);
  const previous = { smtpHost: config.smtpHost, smtpPort: config.smtpPort, smtpUser: config.smtpUser, smtpAppPassword: config.smtpAppPassword, emailFrom: config.emailFrom };
  Object.assign(config, { smtpHost: "smtp.gmail.com", smtpPort: 465, smtpUser: "sender@example.test", smtpAppPassword: "mock-only-secret", emailFrom: "sender@example.test" });
  let attempts = 0;
  const restoreSender = setSmtpSenderForTests(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("self-signed certificate in certificate chain; secret-value-must-not-leak"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
    return { status: "SENT", providerId: "mock-accepted" };
  });
  const authority = { id: "mock-admin-01", email: "admin@city.gov", app_metadata: { role: "authority" }, user_metadata: { full_name: "Test Authority" } };
  const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  try {
    const decisionResponse = response();
    await patchReport({ params: { id: report.id }, body: { status: "REJECTED", falseReportDecision: { reason: "The field inspection confirms this location was fabricated", evidenceSummary: "The officer visited the exact coordinates and reviewed dated location evidence", confirmedByAuthority: true } }, user: authority }, decisionResponse);
    assert.equal(decisionResponse.body.decision.warning_email_status, "FAILED");
    assert.equal(decisionResponse.body.decision.warning_email_error.includes("secret-value-must-not-leak"), false);
    assert.match(decisionResponse.body.decision.warning_email_error, /certificate/i);
    assert.equal(await getFalseReportCount({ userId }), 1);

    const retryResponse = response();
    await retryFalseReportWarningEmail({ params: { id: report.id } }, retryResponse);
    assert.equal(retryResponse.statusCode, 200);
    assert.equal(report.false_report_case.warning_email_status, "SENT");
    assert.equal(attempts, 2);
    assert.equal(await getFalseReportCount({ userId }), 1);
    assert.equal(report.false_report_case.points_deducted, 0);

    const repeatedRetry = response();
    await retryFalseReportWarningEmail({ params: { id: report.id } }, repeatedRetry);
    assert.equal(repeatedRetry.statusCode, 409);
    assert.equal(attempts, 2);
  } finally {
    restoreSender();
    Object.assign(config, previous);
    mockReports.splice(mockReports.indexOf(report), 1);
  }
});
