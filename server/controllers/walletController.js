import { accessToken } from "./authController.js";
import { getUserFromAccessToken, publicUser } from "../services/authService.js";
import { getCitizenNotifications, getCitizenWalletData } from "../services/rewardService.js";
import { listReports } from "../services/reportService.js";

export async function getMyWallet(req, res) {
  const user = await getUserFromAccessToken(accessToken(req));
  if (!user) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in to view your reward wallet." });
  }
  const role = user.app_metadata?.role || "citizen";
  if (role === "authority") {
    return res.status(403).json({ error: "FORBIDDEN", message: "Reward wallets are for citizen accounts." });
  }

  // Fetch reports for this citizen to compute totals
  const reports = await listReports({ userId: user.id }, true);
  const wallet = await getCitizenWalletData(publicUser(user), reports);

  return res.json({ wallet });
}

export async function getWalletNotifications(req, res) {
  const user = await getUserFromAccessToken(accessToken(req));
  if (!user) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in to view notifications." });
  }
  const role = user.app_metadata?.role || "citizen";
  if (role === "authority") {
    return res.json({ notifications: [] });
  }

  const notifications = await getCitizenNotifications(publicUser(user));
  return res.json({ notifications });
}
