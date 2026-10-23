import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { updateReport, mockReports } from "../services/reportService.js";
import { awardReportResolution, calculateRewardPoints } from "../services/rewardService.js";
import { getMyReports, getOneReport } from "../controllers/reportController.js";
import { config } from "../config/env.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { validateUploadedImage } from "../middleware/upload.js";

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
