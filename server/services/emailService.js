import tls from "node:tls";
import { config } from "../config/env.js";

const escapeHtml = (value) => String(value || "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
const cleanHeader = (value) => String(value || "").replace(/[\r\n]/g, " ").trim();
const encodeHeader = (value) => `=?UTF-8?B?${Buffer.from(cleanHeader(value), "utf8").toString("base64")}?=`;
const configured = () => Boolean(config.smtpHost && config.smtpUser && config.smtpAppPassword && config.emailFrom);

function smtpConnection() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: config.smtpHost, port: config.smtpPort, servername: config.smtpHost, timeout: 20000 }, () => resolve(socket));
    socket.once("error", reject);
    socket.once("timeout", () => socket.destroy(new Error("SMTP connection timed out.")));
  });
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

async function smtpSend({ to, subject, text, html }) {
  const socket = await smtpConnection();
  const readLine = createReplyReader(socket);
  const command = async (line, expected) => { socket.write(`${line}\r\n`); return readSmtpReply(readLine, expected); };
  try {
    await readSmtpReply(readLine, 220);
    await command(`EHLO ${config.smtpHost}`, 250);
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
    await command("QUIT", 221);
    return { status: "SENT", providerId: accepted.match(/(?:queued as|id[= ])\s*([\w-]+)/i)?.[1] || null };
  } finally {
    socket.end();
  }
}

async function sendEmail({ to, subject, text, html }) {
  if (!to) return { status: "FAILED", error: "The report has no recipient email address." };
  if (!configured()) return { status: "NOT_CONFIGURED", error: "Configure SMTP_USER, SMTP_APP_PASSWORD, and EMAIL_FROM to deliver citizen notifications." };
  try {
    return await smtpSend({ to, subject, text, html });
  } catch (error) {
    return { status: "FAILED", error: String(error.message || "Email delivery failed.").slice(0, 500) };
  }
}

export async function sendFalseReportWarning({ to, name, caseNumber, reportReference, reason }) {
  const subject = `Authority warning for report ${reportReference}`;
  const text = `Hello ${name || "Citizen"},\n\nThe municipal authority has recorded confirmed false-report case ${caseNumber} for report ${reportReference}.\n\nAuthority reason: ${reason}\n\nIf you believe this decision is incorrect, sign in to Urban Aid Report, open My Reports, and submit an appeal. The authority must review it.\n\nUrban Aid Report`;
  const html = `<p>Hello ${escapeHtml(name || "Citizen")},</p><p>The municipal authority has recorded confirmed false-report case <strong>${caseNumber}</strong> for report <strong>${escapeHtml(reportReference)}</strong>.</p><p><strong>Authority reason:</strong> ${escapeHtml(reason)}</p><p>If you believe this decision is incorrect, sign in to Urban Aid Report, open My Reports, and submit an appeal. The authority must review it.</p><p>Urban Aid Report</p>`;
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
