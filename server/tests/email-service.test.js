import test from "node:test";
import assert from "node:assert/strict";
import { classifySmtpError, getSmtpConfigurationStatus } from "../services/emailService.js";
import { config } from "../config/env.js";

test("SMTP configuration reports missing settings without exposing values", () => {
  const previous = { smtpHost: config.smtpHost, smtpUser: config.smtpUser, smtpAppPassword: config.smtpAppPassword, emailFrom: config.emailFrom };
  try {
    config.smtpHost = "";
    config.smtpUser = "";
    config.smtpAppPassword = "";
    config.emailFrom = "";
    const result = getSmtpConfigurationStatus();
    assert.equal(result.configured, false);
    assert.deepEqual(result.missing, ["SMTP_HOST", "SMTP_USER", "SMTP_APP_PASSWORD", "EMAIL_FROM"]);
    assert.equal(JSON.stringify(result).includes("mock-only-secret"), false);
  } finally { Object.assign(config, previous); }
});

test("SMTP configuration rejects unsupported TLS ports and sender mismatch", () => {
  const previous = { smtpHost: config.smtpHost, smtpPort: config.smtpPort, smtpUser: config.smtpUser, smtpAppPassword: config.smtpAppPassword, emailFrom: config.emailFrom };
  try {
    config.smtpHost = "smtp.gmail.com";
    config.smtpPort = 587;
    config.smtpUser = "sender@example.test";
    config.smtpAppPassword = "test-value";
    config.emailFrom = "sender@example.test";
    assert.equal(getSmtpConfigurationStatus().configured, false);
    config.smtpPort = 465;
    config.emailFrom = "different@example.test";
    assert.equal(getSmtpConfigurationStatus().senderMatch, false);
    assert.equal(getSmtpConfigurationStatus().configured, false);
  } finally { Object.assign(config, previous); }
});

test("SMTP errors map to safe recovery categories without exposing server details", () => {
  const cases = [
    [{ code: "SELF_SIGNED_CERT_IN_CHAIN", message: "private cert details" }, "TLS_CERTIFICATE"],
    [{ message: "SMTP rejected a command: 535-5.7.8 bad auth" }, "SMTP_AUTHENTICATION"],
    [{ message: "SMTP rejected a command: 534-5.7.90 Application-specific password required" }, "SMTP_APP_PASSWORD_REQUIRED"],
    [{ message: "SMTP rejected a command: 534-5.7.14 Please log in through your web browser" }, "SMTP_BROWSER_LOGIN_REQUIRED"],
    [{ code: "ETIMEDOUT", message: "timeout" }, "SMTP_TIMEOUT"],
    [{ code: "ENOTFOUND", message: "lookup" }, "SMTP_DNS"],
    [{ message: "SMTP rejected a command: 550 recipient rejected" }, "SMTP_REJECTED"],
  ];
  for (const [error, expected] of cases) {
    const diagnostic = classifySmtpError(error);
    assert.equal(diagnostic.category, expected);
    assert.equal(diagnostic.message.includes("private cert details"), false);
  }
});
