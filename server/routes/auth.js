import { Router } from "express";
import { forgotPassword, login, logout, oauth, oauthSession, session, signup, updateProfile } from "../controllers/authController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = Router();
router.post("/signup", asyncHandler(signup));
router.post("/login", asyncHandler(login));
router.get("/oauth/:provider", asyncHandler(oauth));
router.post("/oauth/session", asyncHandler(oauthSession));
router.post("/forgot-password", asyncHandler(forgotPassword));
router.get("/session", asyncHandler(session));
router.patch("/profile", asyncHandler(updateProfile));
router.post("/logout", logout);
export default router;
