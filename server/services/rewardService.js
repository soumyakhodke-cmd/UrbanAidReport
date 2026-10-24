import { randomUUID } from "node:crypto";
import { config } from "../config/env.js";
import { requireSupabase } from "../config/supabase.js";

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

export const SEVERITY_POINTS = {
  LOW: 10,
  MEDIUM: 25,
  HIGH: 50,
  CRITICAL: 100
};

export function calculateRewardPoints(severity, priority) {
  const level = String(severity || priority || "LOW").toUpperCase();
  return SEVERITY_POINTS[level] || SEVERITY_POINTS.LOW;
}

// In-memory wallet and transaction store for local demo / offline mode
const mockWallets = new Map([
  [
    "mock-citizen-01",
    {
      user_id: "mock-citizen-01",
      email: "citizen@example.com",
      points_balance: 0,
      total_points_earned: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]
]);

const mockTransactions = [];

export async function awardReportResolution({ report, severity, author }) {
  if (!report || report.status !== "RESOLVED") {
    return { awarded: false, reason: "NOT_RESOLVED" };
  }

  const effectiveSeverity = String(severity || report.severity || "").toUpperCase();
  if (!Object.hasOwn(SEVERITY_POINTS, effectiveSeverity)) throw Object.assign(new Error("An authority-approved severity is required before awarding resolution points."), { status: 422, code: "APPROVED_SEVERITY_REQUIRED" });
  const points = SEVERITY_POINTS[effectiveSeverity];

  if (!config.isSupabaseConfigured) {
    // 1. Check if already rewarded (prevent duplicates)
    const existing = mockTransactions.find((t) => t.report_id === report.id && t.transaction_type === "ISSUE_RESOLVED");
    if (existing) {
      return { awarded: false, reason: "ALREADY_REWARDED", points: existing.points_awarded, transaction: existing };
    }

    // 2. Identify citizen user
    const citizenId = report.user_id || (report.reporter_email === "citizen@example.com" ? "mock-citizen-01" : `user-${report.reporter_email}`);
    
    // 3. Create reward transaction
    const transaction = {
      id: randomUUID(),
      user_id: citizenId,
      reporter_email: report.reporter_email,
      report_id: report.id,
      report_ref: report.reference_no,
      report_title: report.title,
      report_category: report.category,
      points_awarded: points,
      issue_severity: effectiveSeverity,
      reason: `Issue Resolved: ${report.title}`,
      transaction_type: "ISSUE_RESOLVED",
      created_at: new Date().toISOString(),
      acknowledged: false
    };
    mockTransactions.unshift(transaction);

    // 4. Update citizen wallet
    let wallet = mockWallets.get(citizenId);
    if (!wallet) {
      wallet = {
        user_id: citizenId,
        email: report.reporter_email,
        points_balance: 0,
        total_points_earned: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      mockWallets.set(citizenId, wallet);
    }
    wallet.points_balance += points;
    wallet.total_points_earned += points;
    wallet.updated_at = new Date().toISOString();

    report.reward_points = points;
    report.rewarded_at = transaction.created_at;

    return {
      awarded: true,
      points,
      transaction,
      balance: wallet.points_balance,
      citizenId
    };
  }

  // --- Supabase Live Mode ---
  const client = requireSupabase();

  // 1. Check duplicate reward transaction in DB
  const { data: existingTx, error: txCheckError } = await client
    .from("reward_transactions")
    .select("id, points_awarded, created_at")
    .eq("report_id", report.id)
    .eq("transaction_type", "ISSUE_RESOLVED")
    .maybeSingle();

  if (txCheckError) {
    logSupabaseError("reward_transactions.check", txCheckError);
  }
  if (existingTx) {
    return { awarded: false, reason: "ALREADY_REWARDED", points: existingTx.points_awarded, transaction: existingTx };
  }

  // 2. Resolve recipient citizen ID
  let citizenUserId = report.user_id;
  if (!citizenUserId && report.reporter_email) {
    try {
      const { data: usersData } = await client.auth.admin.listUsers();
      const match = usersData?.users?.find((u) => u.email?.toLowerCase() === report.reporter_email.toLowerCase());
      if (match) citizenUserId = match.id;
    } catch {}
  }

  if (!citizenUserId) {
    // If citizen account is not found in auth, generate deterministic uuid for reporter email
    citizenUserId = report.id; // fallback association
  }

  // 3. Insert reward transaction
  const txPayload = {
    id: randomUUID(),
    user_id: citizenUserId,
    report_id: report.id,
    points_awarded: points,
    issue_severity: effectiveSeverity,
    reason: `Issue Resolved: ${report.title}`,
    transaction_type: "ISSUE_RESOLVED",
    created_at: new Date().toISOString()
  };

  const { data: insertedTx, error: insertError } = await client
    .from("reward_transactions")
    .insert(txPayload)
    .select()
    .single();

  if (insertError) {
    logSupabaseError("reward_transactions.insert", insertError);
    // If unique constraint triggered, duplicate prevented
    if (insertError.code === "23505") {
      return { awarded: false, reason: "ALREADY_REWARDED", points };
    }
    throw Object.assign(new Error("Unable to record reward transaction."), { status: 502, code: "REWARD_FAILED" });
  }

  // 4. Update Citizen Wallet atomically
  const { data: currentWallet } = await client
    .from("citizen_wallets")
    .select("points_balance, total_points_earned")
    .eq("user_id", citizenUserId)
    .maybeSingle();

  const newBalance = (currentWallet?.points_balance || 0) + points;
  const newTotal = (currentWallet?.total_points_earned || 0) + points;

  await client.from("citizen_wallets").upsert({
    user_id: citizenUserId,
    points_balance: newBalance,
    total_points_earned: newTotal,
    updated_at: new Date().toISOString()
  });

  // 5. Update report metadata
  await client.from("reports").update({
    reward_points: points,
    rewarded_at: txPayload.created_at
  }).eq("id", report.id);

  report.reward_points = points;
  report.rewarded_at = txPayload.created_at;

  return {
    awarded: true,
    points,
    transaction: insertedTx || txPayload,
    balance: newBalance,
    citizenId: citizenUserId
  };
}

export async function deductFalseReportPoints({ userId, report, requestedPoints, caseNumber }) {
  const amount = Math.max(0, Number.parseInt(requestedPoints, 10) || 0);
  if (!amount || !userId) return 0;
  if (!config.isSupabaseConfigured) {
    const alreadyDeducted = mockTransactions.find((transaction) => transaction.report_id === report.id && transaction.transaction_type === "FALSE_REPORT_DEDUCTION");
    if (alreadyDeducted) return Math.abs(Number(alreadyDeducted.points_awarded) || 0);
    let wallet = mockWallets.get(userId);
    if (!wallet) {
      wallet = { user_id: userId, email: report.reporter_email || "", points_balance: 0, total_points_earned: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      mockWallets.set(userId, wallet);
    }
    const deducted = Math.min(wallet.points_balance, amount);
    if (deducted > 0) {
      wallet.points_balance -= deducted;
      wallet.updated_at = new Date().toISOString();
      mockTransactions.unshift({ id: randomUUID(), user_id: userId, reporter_email: report.reporter_email, report_id: report.id, report_ref: report.reference_no, report_title: report.title, report_category: report.category, points_awarded: -deducted, issue_severity: report.severity || report.priority || "LOW", reason: `Point deduction after confirmed false-report case ${caseNumber}: ${report.reference_no}`, case_number: caseNumber, transaction_type: "FALSE_REPORT_DEDUCTION", created_at: new Date().toISOString(), acknowledged: true });
    }
    return deducted;
  }
  // The Supabase RPC applies wallet changes and writes the negative ledger row atomically.
  return null;
}

export async function restoreFalseReportPoints({ userId, report, points }) {
  const amount = Math.max(0, Number.parseInt(points, 10) || 0);
  if (!amount || !userId || config.isSupabaseConfigured) return;
  let wallet = mockWallets.get(userId);
  if (!wallet) {
    wallet = { user_id: userId, email: report.reporter_email || "", points_balance: 0, total_points_earned: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    mockWallets.set(userId, wallet);
  }
  wallet.points_balance += amount;
  wallet.updated_at = new Date().toISOString();
  mockTransactions.unshift({ id: randomUUID(), user_id: userId, reporter_email: report.reporter_email, report_id: report.id, report_ref: report.reference_no, report_title: report.title, report_category: report.category, points_awarded: amount, issue_severity: report.severity || report.priority || "LOW", reason: `Point deduction reversed after appeal: ${report.reference_no}`, transaction_type: "FALSE_REPORT_REVERSAL", created_at: new Date().toISOString(), acknowledged: true });
}

export async function getCitizenWalletData(user, reportsList = []) {
  if (!user) return null;
  const userId = user.id;
  const email = user.email ? user.email.toLowerCase() : "";

  // Compute reports summary
  const citizenReports = reportsList.filter((r) =>
    (r.user_id && r.user_id === userId) ||
    (r.reporter_email && r.reporter_email.toLowerCase() === email)
  );
  const totalReported = citizenReports.length;
  const totalResolved = citizenReports.filter((r) => r.status === "RESOLVED").length;

  if (!config.isSupabaseConfigured) {
    let wallet = mockWallets.get(userId);
    if (!wallet) {
      // Check if wallet exists under email
      for (const w of mockWallets.values()) {
        if (w.email && w.email.toLowerCase() === email) {
          wallet = w;
          break;
        }
      }
    }
    if (!wallet) {
      wallet = {
        user_id: userId,
        email,
        points_balance: 0,
        total_points_earned: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      mockWallets.set(userId, wallet);
    }

    // Fetch user's transactions
    const transactions = mockTransactions
      .filter((t) => t.user_id === userId || (t.reporter_email && t.reporter_email.toLowerCase() === email))
      .map((t) => {
        const rep = citizenReports.find((r) => r.id === t.report_id);
        return {
          id: t.id,
          points: t.points_awarded,
          severity: t.issue_severity,
          reason: t.reason,
          report_ref: t.report_ref || rep?.reference_no || "UAR-REF",
          report_title: t.report_title || rep?.title || "Civic Issue",
          report_category: t.report_category || rep?.category || "GARBAGE",
          created_at: t.created_at,
          transaction_type: t.transaction_type
        };
      });

    return {
      balance: wallet.points_balance,
      totalEarned: wallet.total_points_earned,
      totalReported,
      totalResolved,
      transactions
    };
  }

  // --- Supabase Live Mode ---
  const client = requireSupabase();

  const { data: walletData } = await client
    .from("citizen_wallets")
    .select("points_balance, total_points_earned")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: txRows } = await client
    .from("reward_transactions")
    .select(`
      id,
      points_awarded,
      issue_severity,
      reason,
      transaction_type,
      created_at,
      report_id,
      reports (
        reference_no,
        title,
        category
      )
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const transactions = (txRows || []).map((t) => ({
    id: t.id,
    points: t.points_awarded,
    severity: t.issue_severity,
    reason: t.reason,
    report_ref: t.reports?.reference_no || "UAR-REF",
    report_title: t.reports?.title || "Civic Issue",
    report_category: t.reports?.category || "GARBAGE",
    created_at: t.created_at,
    transaction_type: t.transaction_type
  }));

  return {
    balance: walletData?.points_balance || 0,
    totalEarned: walletData?.total_points_earned || 0,
    totalReported,
    totalResolved,
    transactions
  };
}

export async function getCitizenNotifications(user) {
  if (!user) return [];
  const userId = user.id;
  const email = user.email ? user.email.toLowerCase() : "";

  if (!config.isSupabaseConfigured) {
    const unread = mockTransactions.filter(
      (t) => (t.user_id === userId || (t.reporter_email && t.reporter_email.toLowerCase() === email)) && !t.acknowledged
    );
    unread.forEach((t) => { t.acknowledged = true; });
    const rewardNotices = unread.map((t) => ({
      id: t.id,
      type: t.transaction_type === "FALSE_REPORT_DEDUCTION" ? "FALSE_REPORT_DEDUCTION" : t.transaction_type === "FALSE_REPORT_REVERSAL" ? "FALSE_REPORT_REVERSAL" : "ISSUE_RESOLVED",
      report_ref: t.report_ref,
      report_title: t.report_title,
      points: t.points_awarded,
      created_at: t.created_at
    }));
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const caseNotices = (await import("./reportService.js")).mockReports
      .filter((report) => {
        const decision = report.false_report_case;
        return decision && ((report.user_id && report.user_id === userId) || String(report.reporter_email || "").toLowerCase() === email) && new Date(decision.decided_at).getTime() >= since;
      })
      .map((report) => ({ id: `false-report-${report.id}`, type: "FALSE_REPORT_DECISION", report_ref: report.reference_no, report_title: report.title, action: report.false_report_case.action, warning_email_status: report.false_report_case.warning_email_status, created_at: report.false_report_case.decided_at }));
    return [...caseNotices, ...rewardNotices];
  }

  // In live Supabase, return the most recent transaction from the last 24h
  const client = requireSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("reward_transactions")
    .select("id, points_awarded, transaction_type, created_at, reports(reference_no, title)")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(3);

  const rewardNotices = (data || []).map((t) => ({
    id: t.id,
    type: t.transaction_type === "FALSE_REPORT_DEDUCTION" ? "FALSE_REPORT_DEDUCTION" : t.transaction_type === "FALSE_REPORT_REVERSAL" ? "FALSE_REPORT_REVERSAL" : "ISSUE_RESOLVED",
    report_ref: t.reports?.reference_no,
    report_title: t.reports?.title,
    points: t.points_awarded,
    created_at: t.created_at
  }));
  const { data: cases } = await client.from("false_report_cases")
    .select("report_id,action,decided_at,warning_email_status,reports(reference_no,title)")
    .eq("citizen_user_id", userId)
    .gte("decided_at", since)
    .order("decided_at", { ascending: false });
  const caseNotices = (cases || []).map((item) => ({
    id: `false-report-${item.report_id}`,
    type: "FALSE_REPORT_DECISION",
    action: item.action,
    warning_email_status: item.warning_email_status,
    report_ref: item.reports?.reference_no,
    report_title: item.reports?.title,
    created_at: item.decided_at
  }));
  return [...caseNotices, ...rewardNotices];
}
