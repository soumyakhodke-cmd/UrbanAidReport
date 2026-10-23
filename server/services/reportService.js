import { randomUUID } from "node:crypto";
import { config } from "../config/env.js";
import { requireSupabase } from "../config/supabase.js";
import { syncMockCitizenAccountBlock } from "./authService.js";
import { awardReportResolution, deductFalseReportPoints, restoreFalseReportPoints } from "./rewardService.js";

export const reportColumns = "id,user_id,reference_no,title,category,description,location,additional_info,status,priority,severity,severity_score,reporter_name,reporter_email,reporter_phone,assigned_to,image_url,image_path,reward_points,rewarded_at,created_at,updated_at";

function publicReport(report) {
  const { user_id, reporter_name, reporter_email, reporter_phone, false_report_cases, false_report_case, ...safeReport } = report;
  return safeReport;
}

function citizenReport(report) {
  const safe = publicReport(report);
  const nestedCase = report.false_report_cases ?? report.false_report_case;
  const decision = Array.isArray(nestedCase) ? nestedCase[0] : nestedCase;
  if (decision) {
    const { reporter_email, citizen_user_id, decided_by_user_id, appeal_reviewed_by_user_id, warning_email_error, ...citizenDecision } = decision;
    safe.false_report_case = citizenDecision;
  }
  return safe;
}

const falseCaseSelect = "false_report_cases(report_id,case_number,action,reason,evidence_summary,points_deducted,penalty_amount,penalty_status,penalty_policy_reference,decided_by_name,decided_at,appeal_status,appeal_message,appealed_at,appeal_review_note,appeal_reviewed_by_name,appeal_reviewed_at,warning_email_status,warning_email_attempted_at,warning_email_provider_id,warning_email_error,reporter_email,citizen_user_id,decided_by_user_id,appeal_reviewed_by_user_id)";

function logSupabaseError(operation, error) {
  if (config.nodeEnv === "production" || !error) return;
  console.error("Supabase operation failed", {
    operation,
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}

// In-memory reports store for local development when Supabase is not configured
export const mockReports = [
  {
    id: "d27ab09a-36aa-3011-a455-0c00a0b1b257",
    reference_no: "UAR-2026-9E8D7C6B",
    title: "Drainage overflow after rain",
    category: "DRAINAGE",
    description: "Clogged stormwater drain causing street waterlogging.",
    location: "Civil Lines, Near Community Center",
    additional_info: null,
    status: "RESOLVED",
    priority: "CRITICAL",
    severity: "CRITICAL",
    severity_score: 95,
    reporter_name: "Civic Resident",
    reporter_email: "resident@city.org",
    reporter_phone: null,
    assigned_to: "Sanitation Rapid Team",
    image_url: null,
    image_path: null,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date().toISOString(),
    report_updates: [
      { id: "upd-2", message: "Drain blockage cleared and disinfected.", status: "RESOLVED", created_by: "Sanitation Rapid Team", created_at: new Date(Date.now() - 86400000 * 3).toISOString() }
    ]
  },
  {
    id: "c16aa08a-25aa-2000-a344-0b00a0a0a146",
    reference_no: "UAR-2026-5A4B3C2D",
    title: "Garbage accumulation near market entrance",
    category: "GARBAGE",
    description: "Waste bins are overflowing and spreading onto the sidewalk.",
    location: "Central Market Gate 2",
    additional_info: null,
    status: "SUBMITTED",
    priority: "MEDIUM",
    severity: "MEDIUM",
    severity_score: 50,
    reporter_name: "Local Resident",
    reporter_email: "resident2@city.org",
    reporter_phone: null,
    assigned_to: null,
    image_url: null,
    image_path: null,
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    updated_at: new Date().toISOString(),
    report_updates: []
  }
];

export async function uploadImage(file) {
  if (!file) return null;
  if (!config.isSupabaseConfigured) {
    // Return base64 data URL for local demo preview
    return {
      path: `reports/mock/${randomUUID()}`,
      url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`
    };
  }
  const client = requireSupabase();
  const extension = file.mimetype.split("/")[1] === "jpeg" ? "jpg" : file.mimetype.split("/")[1];
  const path = `reports/${new Date().getFullYear()}/${randomUUID()}.${extension}`;
  const { error } = await client.storage.from(config.storageBucket).upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) { logSupabaseError("storage.upload report image", error); throw Object.assign(new Error("Unable to store the report image."), { status: 502, code: "IMAGE_UPLOAD_FAILED" }); }
  const { data } = client.storage.from(config.storageBucket).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

export async function createReport(input, file) {
  const image = await uploadImage(file);
  const payload = {
    id: randomUUID(),
    user_id: input.userId || null,
    reference_no: `UAR-${new Date().getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
    title: input.title,
    category: input.category,
    description: input.description,
    location: input.location,
    additional_info: input.additionalInfo || null,
    reporter_name: input.reporterName,
    reporter_email: input.reporterEmail,
    reporter_phone: input.reporterPhone || null,
    image_path: image?.path || null,
    image_url: image?.url || null,
    status: "SUBMITTED",
    priority: null,
    severity: null,
    severity_score: null,
    assigned_to: null,
    reward_points: null,
    rewarded_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    report_updates: []
  };

  if (!config.isSupabaseConfigured) {
    mockReports.unshift(payload);
    return publicReport(payload);
  }

  const client = requireSupabase();
  const { report_updates: _mockUpdates, ...databasePayload } = payload;
  const { data, error } = await client.from("reports").insert(databasePayload).select(reportColumns).single();
  if (error) {
    logSupabaseError("reports.insert", error);
    if (image) await client.storage.from(config.storageBucket).remove([image.path]);
    throw Object.assign(new Error("Unable to save the report."), { status: 502, code: "REPORT_CREATE_FAILED" });
  }
  return publicReport({ ...data, report_updates: [] });
}

export async function listReports(filters, includePrivate = false, includeFalseCase = false) {
  if (!config.isSupabaseConfigured) {
    let result = [...mockReports];
    if (filters.userId) result = result.filter((r) => r.user_id === filters.userId);
    if (filters.status) result = result.filter((r) => r.status === filters.status);
    if (filters.category) result = result.filter((r) => r.category === filters.category);
    if (filters.priority) result = result.filter((r) => r.priority === filters.priority);
    if (filters.reporterEmail) result = result.filter((r) => r.reporter_email.toLowerCase() === filters.reporterEmail.toLowerCase());
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter((r) => r.reference_no.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.location.toLowerCase().includes(q));
    }
    return includePrivate ? result : result.map((report) => includeFalseCase ? citizenReport(report) : publicReport(report));
  }

  const client = requireSupabase();
  let query = client.from("reports").select(`${reportColumns}${includePrivate || includeFalseCase ? `,${falseCaseSelect}` : ""}`).order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.reporterEmail) query = query.eq("reporter_email", filters.reporterEmail.toLowerCase());
  if (filters.search) query = query.or(`reference_no.ilike.%${filters.search}%,title.ilike.%${filters.search}%,location.ilike.%${filters.search}%`);
  const { data, error } = await query.limit(100);
  if (error) throw Object.assign(new Error("Unable to load reports."), { status: 502, code: "REPORT_LIST_FAILED" });
  return includePrivate ? data : data.map((report) => includeFalseCase ? citizenReport(report) : publicReport(report));
}

export async function getReport(id, includePrivate = false, includeFalseCase = false) {
  const trimmed = String(id || "").trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);

  if (!config.isSupabaseConfigured) {
    const report = mockReports.find((r) => isUuid ? r.id === trimmed : r.reference_no.toLowerCase() === trimmed.toLowerCase());
    if (!report) throw Object.assign(new Error("Report not found."), { status: 404, code: "REPORT_NOT_FOUND" });
    return includePrivate ? report : includeFalseCase ? citizenReport(report) : publicReport(report);
  }

  const client = requireSupabase();
  const query = client.from("reports").select(`${reportColumns},report_updates(id,message,status,created_at,created_by)${includePrivate || includeFalseCase ? `,${falseCaseSelect}` : ""}`);
  const { data, error } = await (isUuid ? query.eq("id", trimmed) : query.ilike("reference_no", trimmed)).single();
  if (error || !data) throw Object.assign(new Error("Report not found."), { status: 404, code: "REPORT_NOT_FOUND" });
  return includePrivate ? data : includeFalseCase ? citizenReport(data) : publicReport(data);
}

export async function confirmFalseReport({ reportId, reason, evidenceSummary, authorityUser, authorityName }) {
  const cleanReason = String(reason || "").trim();
  const cleanEvidence = String(evidenceSummary || "").trim();
  if (cleanReason.length < 10 || cleanReason.length > 500) throw Object.assign(new Error("Provide a reason between 10 and 500 characters."), { status: 422, code: "FALSE_REPORT_REASON_INVALID" });
  if (cleanEvidence.length < 10 || cleanEvidence.length > 1000) throw Object.assign(new Error("Provide an evidence summary between 10 and 1000 characters."), { status: 422, code: "FALSE_REPORT_EVIDENCE_INVALID" });

  if (!config.isSupabaseConfigured) {
    const report = mockReports.find((item) => item.id === reportId);
    if (!report) throw Object.assign(new Error("Report not found."), { status: 404, code: "REPORT_NOT_FOUND" });
    if (report.status === "RESOLVED") throw Object.assign(new Error("Reopen a resolved report before confirming it as false."), { status: 409, code: "FALSE_REPORT_RESOLVED" });
    if (report.false_report_case) throw Object.assign(new Error("A false-report decision already exists for this report."), { status: 409, code: "FALSE_REPORT_ALREADY_DECIDED" });
    const email = String(report.reporter_email || "").trim().toLowerCase();
    // Only a stable authenticated account can accumulate repeat sanctions.
    const caseNumber = report.user_id ? mockReports.filter((item) => item.false_report_case && item.false_report_case.appeal_status !== "ACCEPTED" && item.user_id === report.user_id).length + 1 : 1;
    const action = caseNumber <= 2 ? "WARNING" : caseNumber <= 5 ? "POINT_DEDUCTION" : "ACCOUNT_BLOCK";
    const pointsDeducted = action === "POINT_DEDUCTION" ? await deductFalseReportPoints({ userId: report.user_id, report, requestedPoints: config.falseReportPointDeduction }) : 0;
    const decision = {
      report_id: report.id,
      case_number: caseNumber,
      action,
      reason: cleanReason,
      evidence_summary: cleanEvidence,
      points_deducted: pointsDeducted || 0,
      penalty_amount: null,
      penalty_status: "NOT_APPLICABLE",
      penalty_policy_reference: null,
      decided_by_name: authorityName || "Municipal Authority",
      decided_at: new Date().toISOString(),
      appeal_status: "NOT_FILED",
      warning_email_status: action === "WARNING" ? "PENDING" : "NOT_APPLICABLE",
      reporter_email: email,
      citizen_user_id: report.user_id || null,
    };
    report.false_report_case = decision;
    report.status = "REJECTED";
    report.updated_at = decision.decided_at;
    return { decision, report };
  }

  const { data: decision, error } = await requireSupabase().rpc("confirm_false_report", {
    p_report_id: reportId,
    p_reason: cleanReason,
    p_evidence_summary: cleanEvidence,
    p_authority_user_id: authorityUser?.id || null,
    p_authority_name: authorityName || "Municipal Authority",
    p_point_deduction: config.falseReportPointDeduction,
  });
  if (error) {
    logSupabaseError("false_report.confirm", error);
    const status = error.code === "P0002" ? 404 : error.code === "23505" ? 409 : error.code === "22023" ? 409 : 502;
    throw Object.assign(new Error(error.message || "Unable to record the false-report decision."), { status, code: error.code || "FALSE_REPORT_DECISION_FAILED" });
  }
  return { decision, report: await getReport(reportId, true, true) };
}

export async function updateFalseReportWarningEmail(reportId, result) {
  const values = {
    warning_email_status: result.status,
    warning_email_attempted_at: new Date().toISOString(),
    warning_email_provider_id: result.providerId || null,
    warning_email_error: result.error || null,
  };
  if (!config.isSupabaseConfigured) {
    const report = mockReports.find((item) => item.id === reportId);
    if (report?.false_report_case) Object.assign(report.false_report_case, values);
    return;
  }
  const { error } = await requireSupabase().from("false_report_cases").update(values).eq("report_id", reportId);
  if (error) logSupabaseError("false_report.warning_email_status", error);
}

export async function getFalseReportCount({ userId, email }) {
  if (!config.isSupabaseConfigured) {
    return mockReports.filter((report) => report.false_report_case && report.false_report_case.appeal_status !== "ACCEPTED" && (
      userId ? report.user_id === userId : String(report.reporter_email || "").toLowerCase() === String(email || "").toLowerCase()
    )).length;
  }
  if (!userId) return 0;
  const { count, error } = await requireSupabase().from("false_report_cases").select("report_id", { count: "exact", head: true }).eq("citizen_user_id", userId).neq("appeal_status", "ACCEPTED");
  if (error) throw Object.assign(new Error("Unable to load the account's confirmed false-report count."), { status: 502, code: "FALSE_REPORT_COUNT_FAILED" });
  return count || 0;
}

export async function submitFalseReportAppeal({ reportId, user, message }) {
  const appealMessage = String(message || "").trim();
  if (appealMessage.length < 10 || appealMessage.length > 1000) throw Object.assign(new Error("Explain your appeal in 10 to 1000 characters."), { status: 422, code: "FALSE_REPORT_APPEAL_INVALID" });

  if (!config.isSupabaseConfigured) {
    const report = mockReports.find((item) => item.id === reportId);
    if (!report || (report.user_id ? report.user_id !== user.id : String(report.reporter_email || "").toLowerCase() !== String(user.email || "").toLowerCase())) throw Object.assign(new Error("Report not found for this account."), { status: 404, code: "REPORT_NOT_FOUND" });
    const decision = report.false_report_case;
    if (!decision) throw Object.assign(new Error("There is no false-report decision to appeal."), { status: 404, code: "FALSE_REPORT_CASE_NOT_FOUND" });
    if (decision.appeal_status !== "NOT_FILED") throw Object.assign(new Error("An appeal has already been submitted for this decision."), { status: 409, code: "FALSE_REPORT_APPEAL_EXISTS" });
    decision.appeal_status = "PENDING";
    decision.appeal_message = appealMessage;
    decision.appealed_at = new Date().toISOString();
    return { decision: citizenReport(report).false_report_case, report: citizenReport(report) };
  }

  const client = requireSupabase();
  const { data: ownReport, error: reportError } = await client.from("reports").select("id,user_id,reporter_email").eq("id", reportId).maybeSingle();
  if (reportError || !ownReport || (ownReport.user_id ? ownReport.user_id !== user.id : String(ownReport.reporter_email || "").toLowerCase() !== String(user.email || "").toLowerCase())) throw Object.assign(new Error("Report not found for this account."), { status: 404, code: "REPORT_NOT_FOUND" });
  const { data: decision, error } = await client.from("false_report_cases").update({ appeal_status: "PENDING", appeal_message: appealMessage, appealed_at: new Date().toISOString() }).eq("report_id", reportId).eq("appeal_status", "NOT_FILED").select().maybeSingle();
  if (error) throw Object.assign(new Error("Unable to submit your appeal."), { status: 502, code: "FALSE_REPORT_APPEAL_FAILED" });
  if (!decision) throw Object.assign(new Error("An appeal has already been submitted for this decision."), { status: 409, code: "FALSE_REPORT_APPEAL_EXISTS" });
  return { decision: citizenReport({ false_report_cases: decision }).false_report_case, report: await getReport(reportId, false, true) };
}

export async function reviewFalseReportAppeal({ reportId, accept, reviewNote, authorityUser, authorityName }) {
  const note = String(reviewNote || "").trim();
  if (note.length < 5 || note.length > 500) throw Object.assign(new Error("Provide a review note between 5 and 500 characters."), { status: 422, code: "FALSE_REPORT_REVIEW_NOTE_INVALID" });
  if (!config.isSupabaseConfigured) {
    const report = mockReports.find((item) => item.id === reportId);
    const decision = report?.false_report_case;
    if (!report || !decision || decision.appeal_status !== "PENDING") throw Object.assign(new Error("There is no pending appeal for this report."), { status: 409, code: "FALSE_REPORT_APPEAL_NOT_PENDING" });
    decision.appeal_status = accept ? "ACCEPTED" : "REJECTED";
    decision.appeal_review_note = note;
    decision.appeal_reviewed_by_name = authorityName || "Municipal Authority";
    decision.appeal_reviewed_at = new Date().toISOString();
    if (accept) {
      decision.penalty_status = ["PENALTY_NOTICE", "PENALTY_REVIEW"].includes(decision.action) ? "CANCELLED_ON_APPEAL" : decision.penalty_status;
      await restoreFalseReportPoints({ userId: report.user_id, report, points: decision.points_deducted });
      report.status = "UNDER_REVIEW";
      report.updated_at = decision.appeal_reviewed_at;
      decision.action = "OVERTURNED";
      const activeCount = report.user_id ? mockReports.filter((item) => item.user_id === report.user_id && item.false_report_case && item.false_report_case.appeal_status !== "ACCEPTED").length : 0;
      syncMockCitizenAccountBlock(report.user_id, activeCount > 5);
    }
    return { decision, report };
  }

  const { data: decision, error } = await requireSupabase().rpc("review_false_report_appeal", {
    p_report_id: reportId,
    p_accept: Boolean(accept),
    p_review_note: note,
    p_authority_user_id: authorityUser?.id || null,
    p_authority_name: authorityName || "Municipal Authority",
  });
  if (error) {
    logSupabaseError("false_report.review_appeal", error);
    const status = error.code === "P0002" ? 404 : error.code === "22023" ? 409 : 502;
    throw Object.assign(new Error(error.message || "Unable to review this appeal."), { status, code: error.code || "FALSE_REPORT_APPEAL_REVIEW_FAILED" });
  }
  if (accept) await requireSupabase().from("reports").update({ status: "UNDER_REVIEW", updated_at: new Date().toISOString() }).eq("id", reportId);
  return { decision, report: await getReport(reportId, true, true) };
}

export async function updateReport(id, changes, author) {
  const allowed = ["status", "priority", "severity", "category", "assigned_to"];
  const update = Object.fromEntries(Object.entries(changes).filter(([key, value]) => allowed.includes(key) && value !== undefined));
  if (!Object.keys(update).length) throw Object.assign(new Error("No supported report changes were provided."), { status: 400, code: "INVALID_UPDATE" });

  if (!config.isSupabaseConfigured) {
    const report = mockReports.find((r) => r.id === id);
    if (!report) throw Object.assign(new Error("Report not found or could not be updated."), { status: 404, code: "REPORT_UPDATE_FAILED" });
    if (update.status === "RESOLVED" && report.false_report_case) throw Object.assign(new Error("A report confirmed as false cannot be resolved."), { status: 409, code: "FALSE_REPORT_CANNOT_RESOLVE" });
    if (update.status === "RESOLVED" && !(update.severity || report.severity)) throw Object.assign(new Error("Set an authority-approved severity before resolving this report."), { status: 422, code: "SEVERITY_REQUIRED_FOR_RESOLUTION" });
    Object.assign(report, update, { updated_at: new Date().toISOString() });
    if (changes.message?.trim()) {
      if (!report.report_updates) report.report_updates = [];
      report.report_updates.unshift({
        id: randomUUID(),
        report_id: id,
        message: changes.message.trim(),
        status: report.status,
        created_by: author || "Authority desk",
        created_at: new Date().toISOString()
      });
    }

    let rewardResult = null;
    if (report.status === "RESOLVED") {
      rewardResult = await awardReportResolution({
        report,
        severity: update.severity || report.severity,
        author
      });
    }
    return { ...report, reward_result: rewardResult };
  }

  const client = requireSupabase();
  const currentReport = await getReport(id, true);
  if (update.status === "RESOLVED") {
    const { data: falseCase, error: caseError } = await client.from("false_report_cases").select("report_id").eq("report_id", id).maybeSingle();
    if (caseError) throw Object.assign(new Error("Unable to verify report eligibility for resolution."), { status: 502, code: "REPORT_RESOLUTION_CHECK_FAILED" });
    if (falseCase) throw Object.assign(new Error("A report confirmed as false cannot be resolved."), { status: 409, code: "FALSE_REPORT_CANNOT_RESOLVE" });
    if (!(update.severity || currentReport.severity)) throw Object.assign(new Error("Set an authority-approved severity before resolving this report."), { status: 422, code: "SEVERITY_REQUIRED_FOR_RESOLUTION" });
  }
  const { data, error } = await client.from("reports").update(update).eq("id", id).select(reportColumns).single();
  if (error || !data) throw Object.assign(new Error("Report not found or could not be updated."), { status: 404, code: "REPORT_UPDATE_FAILED" });
  if (changes.message?.trim()) await client.from("report_updates").insert({ report_id: id, message: changes.message.trim(), status: data.status, created_by: author || "Authority" });

  let rewardResult = null;
  if (data.status === "RESOLVED") {
    rewardResult = await awardReportResolution({
      report: data,
      severity: update.severity || data.severity,
      author
    });
  }

  return { ...data, reward_result: rewardResult };
}
