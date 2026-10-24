import "dotenv/config";

export const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  publicAppUrl: process.env.PUBLIC_APP_URL?.replace(/\/$/, ""),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
  falseReportPointDeduction: Math.max(0, Number.parseInt(process.env.FALSE_REPORT_POINT_DEDUCTION || "25", 10) || 25),
  smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
  smtpPort: process.env.SMTP_PORT === undefined ? 465 : Number(process.env.SMTP_PORT),
  smtpTlsCaFile: process.env.SMTP_TLS_CA_FILE || "",
  smtpUser: process.env.SMTP_USER || "",
  smtpAppPassword: (process.env.SMTP_APP_PASSWORD || "").replace(/\s/g, ""),
  emailFrom: process.env.EMAIL_FROM || process.env.SMTP_USER || "",
  // This project is running in local demo mode. Remote Supabase is deliberately
  // disabled so stale or unreachable credentials cannot stall the website.
  isSupabaseConfigured: false,
};
