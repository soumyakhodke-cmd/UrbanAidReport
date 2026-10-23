import app from "./app.js";
import { config } from "./config/env.js";

const server = app.listen(config.port, () => console.log(`Urban Aid Report is running in local demo mode on port ${config.port}.`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
