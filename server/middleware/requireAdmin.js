import { accessToken } from "../controllers/authController.js";
import { getUserFromAccessToken } from "../services/authService.js";

export async function requireAdmin(req, res, next) {
  const user = await getUserFromAccessToken(accessToken(req));
  if (!user) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in as an authority to continue." });
  if (user.app_metadata?.role !== "authority") return res.status(403).json({ error: "FORBIDDEN", message: "Authority access is required." });
  req.isAdmin = true;
  req.user = user;
  return next();
}
