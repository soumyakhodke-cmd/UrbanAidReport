export function notFoundHandler(req, res) {
  res.status(404).json({ error: "NOT_FOUND", message: `No route found for ${req.method} ${req.path}.` });
}

export function errorHandler(error, req, res, next) {
  if (error.name === "MulterError") {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Photo must be no larger than 5 MB."
      : error.code === "LIMIT_FILE_COUNT"
        ? "Upload one photo at a time."
        : error.code === "LIMIT_FIELD_VALUE"
          ? "One of the report details is too long. Shorten it and try again."
          : "The report form contains too many fields. Review the form and try again.";
    return res.status(400).json({ error: "INVALID_UPLOAD", message });
  }
  const status = error.status || 500;
  if (status >= 500 && status !== 503) console.error(error);
  res.status(status).json({ error: error.code || "SERVER_ERROR", message: status === 503 ? error.message : status >= 500 ? "Something went wrong. Please try again later." : error.message });
}
