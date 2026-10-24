import { Router } from "express";
import { appealFalseReport, getMyFalseReportCount, getMyReports, getOneReport, getReports, markFalseReport, patchReport, reviewFalseAppeal, retryFalseReportWarningEmail, submitReport } from "../controllers/reportController.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { uploadReportImage, validateUploadedImage } from "../middleware/upload.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = Router();
router.post("/", uploadReportImage, validateUploadedImage, asyncHandler(submitReport));
router.post("/:id/false-report-appeal", asyncHandler(appealFalseReport));
router.get("/admin/all", asyncHandler(requireAdmin), asyncHandler(getReports));
router.get("/mine/false-report-count", asyncHandler(getMyFalseReportCount));
router.get("/mine", asyncHandler(getMyReports));
router.get("/", asyncHandler(getReports));
router.post("/:id/false-report", asyncHandler(requireAdmin), asyncHandler(markFalseReport));
router.post("/:id/false-report-warning-email/retry", asyncHandler(requireAdmin), asyncHandler(retryFalseReportWarningEmail));
router.post("/:id/false-report-appeal/review", asyncHandler(requireAdmin), asyncHandler(reviewFalseAppeal));
router.get("/:id", asyncHandler(getOneReport));
router.patch("/:id", asyncHandler(requireAdmin), asyncHandler(patchReport));
export default router;
