import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { config } from "../config/env.js";

const escapeHtml = (value) => String(value || "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
const cleanHeader = (value) => String(value || "").replace(/[\r\n]/g, " ").trim();
const encodeHeader = (value) => `=?UTF-8?B?${Buffer.from(cleanHeader(value), "utf8").toString("base64")}?=`;
const diagnosticMessages = {
  NOT_CONFIGURED: "Email is not configured. Set SMTP_USER, SMTP_APP_PASSWORD, and EMAIL_FROM on the server.",
  INVALID_CONFIGURATION: "SMTP settings are invalid. Use smtp.gmail.com with port 465 (implicit TLS) and make EMAIL_FROM match SMTP_USER.",
  TLS_CERTIFICATE: "SMTP TLS certificate validation failed. Check the network or provide the trusted inspection CA using SMTP_TLS_CA_FILE.",
  SMTP_AUTHENTICATION: "Gmail rejected SMTP authentication. Check SMTP_USER and use a current Google App Password.",
  SMTP_APP_PASSWORD_REQUIRED: "Gmail requires an App Password. Create one while signed into the same Google account configured as SMTP_USER, then save it as SMTP_APP_PASSWORD.",
  SMTP_BROWSER_LOGIN_REQUIRED: "Gmail requires an account security check. Sign into that Gmail account in a browser, complete any security prompts, then run the SMTP verification again.",
  SMTP_TIMEOUT: "The SMTP connection timed out. Check network access to smtp.gmail.com on port 465.",
  SMTP_DNS: "The SMTP hostname could not be resolved. Check DNS and SMTP_HOST.",
  SMTP_CONNECTION: "The SMTP server could not be reached. Check network access and firewall rules.",
  SMTP_REJECTED: "The SMTP server rejected the sender, recipient, or message. Check the sender account and recipient address.",
  SMTP_FAILED: "SMTP delivery failed. Check the server logs for a sanitized diagnostic category.",
};

export function getSmtpConfigurationStatus() {
  const missing = [
    ["SMTP_HOST", config.smtpHost],
    ["SMTP_USER", config.smtpUser],
    ["SMTP_APP_PASSWORD", config.smtpAppPassword],
    ["EMAIL_FROM", config.emailFrom],
  ].filter(([, value]) => !value).map(([name]) => name);
  const senderMatch = !config.smtpUser || !config.emailFrom || extractAddress(config.emailFrom).toLowerCase() === config.smtpUser.toLowerCase();
  const valid = !missing.length && Boolean(config.smtpHost) && config.smtpPort === 465 && senderMatch;
  return { configured: valid, missing, host: config.smtpHost || null, port: Number.isFinite(config.smtpPort) ? config.smtpPort : null, secureMode: config.smtpPort === 465 ? "implicit TLS" : "invalid", senderMatch };
}

function extractAddress(value) {
  const match = String(value || "").match(/<([^<>]+)>/);
  return (match ? match[1] : String(value || "")).trim();
}

export function classifySmtpError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "");
  const smtpCode = Number(message.match(/(?:SMTP rejected a command:\s*)?(\d{3})[ -]/)?.[1] || 0);
  const enhancedCode = message.match(/\b(?:534|535)[ -](5\.\d+\.\d+)\b/i)?.[1] || null;
  let category = "SMTP_FAILED";
  if (code === "INVALID_SMTP_CONFIGURATION") category = "INVALID_CONFIGURATION";
  else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|ISSUER/.test(code) || /certificate|self-signed/i.test(message)) category = "TLS_CERTIFICATE";
  else if (enhancedCode === "5.7.9" || enhancedCode === "5.7.90") category = "SMTP_APP_PASSWORD_REQUIRED";
  else if (enhancedCode === "5.7.14") category = "SMTP_BROWSER_LOGIN_REQUIRED";
  else if (/535|534|authentication|invalid credentials/i.test(message) || error?.smtpCommand === "AUTH") category = "SMTP_AUTHENTICATION";
  else if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || /timed out|timeout/i.test(message)) category = "SMTP_TIMEOUT";
  else if (["ENOTFOUND", "EAI_AGAIN", "ENODATA"].includes(code)) category = "SMTP_DNS";
  else if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"].includes(code)) category = "SMTP_CONNECTION";
  else if (smtpCode >= 400 || /SMTP rejected a command|recipient email address/i.test(message)) category = "SMTP_REJECTED";
  return { category, message: diagnosticMessages[category], providerCode: enhancedCode || code || (smtpCode ? String(smtpCode) : null) };
}

function smtpConnection() {
  return new Promise((resolve, reject) => {
    if (config.smtpPort !== 465) return reject(Object.assign(new Error("This SMTP transport uses implicit TLS on port 465."), { code: "INVALID_SMTP_CONFIGURATION" }));
    const tlsOptions = { host: config.smtpHost, port: config.smtpPort, servername: config.smtpHost, timeout: 20000, rejectUnauthorized: true };
    if (config.smtpTlsCaFile) {
      const caPath = path.resolve(process.cwd(), config.smtpTlsCaFile);
      // Trust the normal Node roots plus the administrator-provided network CA.
      // Keep certificate verification enabled; never bypass TLS validation.
      try {
        const ca = fs.readFileSync(caPath);
        if (!ca.includes(Buffer.from("-----BEGIN CERTIFICATE-----"))) throw new Error("Invalid CA file.");
        tlsOptions.ca = [...tls.rootCertificates, ca];
      } catch {
        return reject(Object.assign(new Error("Configured SMTP CA file is missing or invalid."), { code: "INVALID_SMTP_CONFIGURATION" }));
      }
    }
    const socket = tls.connect(tlsOptions, () => resolve(socket));
    socket.once("error", reject);
    socket.once("timeout", () => socket.destroy(new Error("SMTP connection timed out.")));
  });
}

let activeSmtpSender = smtpSend;
export function setSmtpSenderForTests(sender) {
  const previous = activeSmtpSender;
  activeSmtpSender = sender;
  return () => { activeSmtpSender = previous; };
}

function createReplyReader(socket) {
  let buffer = "";
  const lines = [];
  const waiters = [];
  let failure;
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const split = buffer.split(/\r?\n/);
    buffer = split.pop();
    for (const line of split) {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(line); else lines.push(line);
    }
  });
  socket.on("error", (error) => { failure = error; while (waiters.length) waiters.shift().reject(error); });
  socket.on("close", () => { failure ||= new Error("SMTP connection closed unexpectedly."); while (waiters.length) waiters.shift().reject(failure); });
  return () => lines.length ? Promise.resolve(lines.shift()) : failure ? Promise.reject(failure) : new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}

async function readSmtpReply(readLine, expected) {
  const lines = [];
  let line;
  do {
    line = await readLine();
    lines.push(line);
  } while (/^\d{3}-/.test(line));
  if (!new RegExp(`^${expected}\\s`).test(line)) throw new Error(`SMTP rejected a command: ${lines.join(" ").slice(0, 400)}`);
  return lines.join("\n");
}

export async function verifySmtpConnection() {
  const settings = getSmtpConfigurationStatus();
  if (settings.missing.length) return { status: "NOT_CONFIGURED", category: "NOT_CONFIGURED", message: `${diagnosticMessages.NOT_CONFIGURED} Missing: ${settings.missing.join(", ")}.` };
  if (!settings.configured) return { status: "FAILED", category: "INVALID_CONFIGURATION", message: diagnosticMessages.INVALID_CONFIGURATION };
  let socket;
  try {
    socket = await smtpConnection();
    const readLine = createReplyReader(socket);
    const command = async (line, expected) => { socket.write(`${line}\r\n`); return readSmtpReply(readLine, expected); };
    await readSmtpReply(readLine, 220);
    await command("EHLO urban-aid-report.local", 250);
    await command("AUTH LOGIN", 334);
    await command(Buffer.from(config.smtpUser).toString("base64"), 334);
    await command(Buffer.from(config.smtpAppPassword).toString("base64"), 235);
    socket.end("QUIT\r\n");
    return { status: "READY", category: null, message: "Gmail accepted the SMTP connection and authentication. No email was sent." };
  } catch (error) {
    const diagnostic = classifySmtpError(error);
    console.error("SMTP verification failed", { category: diagnostic.category, providerCode: diagnostic.providerCode });
    return { status: "FAILED", category: diagnostic.category, message: diagnostic.message };
  } finally {
    socket?.end();
  }
}

async function smtpSend({ to, subject, text, html }) {
  if (config.smtpPort !== 465) throw Object.assign(new Error("The SMTP transport currently requires implicit TLS on port 465."), { code: "INVALID_SMTP_CONFIGURATION" });
  const senderAddress = extractAddress(config.emailFrom);
  if (senderAddress.toLowerCase() !== config.smtpUser.toLowerCase()) throw Object.assign(new Error("Gmail sender must match the authenticated account."), { code: "INVALID_SMTP_CONFIGURATION" });
  const socket = await smtpConnection();
  const readLine = createReplyReader(socket);
  const command = async (line, expected) => { socket.write(`${line}\r\n`); return readSmtpReply(readLine, expected); };
  try {
    await readSmtpReply(readLine, 220);
    await command("EHLO urban-aid-report.local", 250);
    await command("AUTH LOGIN", 334);
    await command(Buffer.from(config.smtpUser).toString("base64"), 334);
    await command(Buffer.from(config.smtpAppPassword).toString("base64"), 235);
    const fromAddress = config.smtpUser.replace(/[<>\r\n]/g, "");
    const toAddress = String(to || "").trim().replace(/[<>\r\n]/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddress)) throw new Error("The report has no valid recipient email address.");
    await command(`MAIL FROM:<${fromAddress}>`, 250);
    await command(`RCPT TO:<${toAddress}>`, 250);
    await command("DATA", 354);

    const boundary = `urban-aid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const fromLabel = config.emailFrom.includes("<") ? config.emailFrom.slice(0, config.emailFrom.indexOf("<")).trim() : "Urban Aid Report";
    const message = [
      `From: ${encodeHeader(fromLabel)} <${fromAddress}>`, `To: <${toAddress}>`, `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary=\"${boundary}\"`, "",
      `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "",
      `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(html, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "",
      `--${boundary}--`, "",
    ].join("\r\n").replace(/(^|\r\n)\./g, "$1..");
    socket.write(`${message}\r\n.\r\n`);
    const accepted = await readSmtpReply(readLine, 250);
    // DATA's final 250 is the SMTP acceptance point. A later QUIT failure must
    // not mark an accepted message as failed and cause duplicate retries.
    socket.end("QUIT\r\n");
    return { status: "SENT", providerId: accepted.match(/(?:queued as|id[= ])\s*([\w-]+)/i)?.[1] || null };
  } finally {
    socket.end();
  }
}

async function sendEmail({ to, subject, text, html }) {
  if (!to) return { status: "FAILED", error: "The report has no recipient email address." };
  const settings = getSmtpConfigurationStatus();
  if (settings.missing.length) return { status: "NOT_CONFIGURED", error: `${diagnosticMessages.NOT_CONFIGURED} Missing: ${settings.missing.join(", ")}.`, errorCategory: "NOT_CONFIGURED" };
  if (!settings.configured) return { status: "FAILED", error: diagnosticMessages.INVALID_CONFIGURATION, errorCategory: "INVALID_CONFIGURATION" };
  try {
    return await activeSmtpSender({ to, subject, text, html });
  } catch (error) {
    const diagnostic = classifySmtpError(error);
    // Keep logs useful while excluding addresses, message content, and credentials.
    console.error("SMTP delivery failed", { category: diagnostic.category, providerCode: diagnostic.providerCode });
    return { status: "FAILED", error: diagnostic.message, errorCategory: diagnostic.category };
  }
}

export function logSmtpStartupStatus() {
  const status = getSmtpConfigurationStatus();
  if (!status.configured) {
    const details = status.missing.length ? ` Missing settings: ${status.missing.join(", ")}.` : " Check SMTP_HOST, SMTP_PORT, and sender alignment.";
    console.warn(`SMTP notifications are unavailable.${details}`);
    return status;
  }
  console.info(`SMTP configuration loaded for ${status.host}:${status.port} (${status.secureMode}); certificate verification is enabled. No test email was sent.`);
  return status;
}

export async function sendFalseReportWarning({ to, name, caseNumber, reportReference, reason }) {
  const subject = `Authority warning for report ${reportReference}`;
  const policy = "Cases 1–2 receive warning emails; cases 3–5 may deduct available reward points (up to the configured amount); case 6 and later block new report submissions. You may still sign in, view your reports and wallet, and appeal a decision.";
  const text = `Hello ${name || "Citizen"},\n\nThe municipal authority has recorded confirmed false-report case ${caseNumber} for report ${reportReference}.\n\nAuthority reason: ${reason}\n\nAccount policy: ${policy}\n\nIf you believe this decision is incorrect, sign in to Urban Aid Report, open My Reports, and submit an appeal. The authority must review it.\n\nUrban Aid Report`;
  const html = `<p>Hello ${escapeHtml(name || "Citizen")},</p><p>The municipal authority has recorded confirmed false-report case <strong>${caseNumber}</strong> for report <strong>${escapeHtml(reportReference)}</strong>.</p><p><strong>Authority reason:</strong> ${escapeHtml(reason)}</p><p><strong>Account policy:</strong> ${escapeHtml(policy)}</p><p>If you believe this decision is incorrect, sign in to Urban Aid Report, open My Reports, and submit an appeal. The authority must review it.</p><p>Urban Aid Report</p>`;
  return sendEmail({ to, subject, text, html });
}

export async function sendAuthorityReportAction({ to, name, report, action, details = [] }) {
  const title = report.reference_no || `report ${report.id}`;
  const safeDetails = details.filter(Boolean);
  const subject = `Update on your Urban Aid report ${title}`;
  const text = [`Hello ${name || "Citizen"},`, "", `The municipal authority has updated report ${title}.`, `Issue: ${report.title || "Civic issue"}`, `Current status: ${String(report.status || "UPDATED").replaceAll("_", " ")}`, `Authority action: ${action}`, ...safeDetails.map((item) => `Details: ${item}`), "", "Sign in to Urban Aid Report to view your report history.", "Urban Aid Report"].join("\n");
  const detailHtml = safeDetails.map((item) => `<p><strong>Details:</strong> ${escapeHtml(item)}</p>`).join("");
  const html = `<p>Hello ${escapeHtml(name || "Citizen")},</p><p>The municipal authority has updated report <strong>${escapeHtml(title)}</strong>.</p><p><strong>Issue:</strong> ${escapeHtml(report.title || "Civic issue")}<br><strong>Current status:</strong> ${escapeHtml(String(report.status || "UPDATED").replaceAll("_", " "))}<br><strong>Authority action:</strong> ${escapeHtml(action)}</p>${detailHtml}<p>Sign in to Urban Aid Report to view your report history.</p><p>Urban Aid Report</p>`;
  return sendEmail({ to, subject, text, html });
}
