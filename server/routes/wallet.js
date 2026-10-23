import { Router } from "express";
import { getMyWallet, getWalletNotifications } from "../controllers/walletController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = Router();

router.get("/", asyncHandler(getMyWallet));
router.get("/notifications", asyncHandler(getWalletNotifications));

export default router;
