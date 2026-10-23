import multer from "multer";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
export const uploadReportImage = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 16, fieldSize: 16 * 1024, parts: 17 },
  fileFilter(req, file, callback) {
    if (!allowedTypes.has(file.mimetype)) {
      const error = new Error("Upload a JPG, PNG, or WebP image no larger than 5 MB.");
      error.status = 400; error.code = "INVALID_IMAGE";
      return callback(error);
    }
    return callback(null, true);
  },
}).single("image");

export function validateUploadedImage(req, res, next) {
  if (!req.file) return next();
  const { buffer, mimetype } = req.file;
  const validSignature = mimetype === "image/jpeg"
    ? buffer.length >= 5 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
    : mimetype === "image/png"
      ? buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buffer.readUInt32BE(8) === 13 && buffer.toString("ascii", 12, 16) === "IHDR" && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0 && buffer.subarray(-8, -4).toString("ascii") === "IEND" && buffer.readUInt32BE(buffer.length - 12) === 0
      : mimetype === "image/webp"
        ? buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.readUInt32LE(4) === buffer.length - 8 && buffer.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(buffer.toString("ascii", 12, 16)) && buffer.readUInt32LE(16) > 0 && buffer.readUInt32LE(16) <= buffer.length - 20
        : false;
  if (!validSignature) return res.status(400).json({ error: "INVALID_IMAGE", message: "The selected file is not a valid JPEG, PNG, or WebP image." });
  return next();
}
