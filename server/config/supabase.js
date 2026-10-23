export function requireSupabase() {
  const error = new Error("Remote database mode is disabled. The app is running with local demo data.");
  error.status = 503;
  error.code = "REMOTE_DATABASE_DISABLED";
  throw error;
}
