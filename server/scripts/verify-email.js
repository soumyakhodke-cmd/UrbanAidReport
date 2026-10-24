import { getSmtpConfigurationStatus, verifySmtpConnection } from "../services/emailService.js";

const config = getSmtpConfigurationStatus();
console.log(`SMTP target: ${config.host || "not set"}:${config.port ?? "not set"} (${config.secureMode}).`);
if (!config.configured) {
  const missing = config.missing.length ? ` Missing settings: ${config.missing.join(", ")}.` : " Check the host, port, and sender alignment.";
  console.error(`SMTP configuration is not ready.${missing}`);
  process.exitCode = 1;
} else {
  const result = await verifySmtpConnection();
  console.log(`${result.status}: ${result.message}`);
  if (result.status !== "READY") process.exitCode = 1;
}
