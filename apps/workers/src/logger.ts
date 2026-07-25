import pino from "pino";

/** Logs structurés JSON : exploitables par n'importe quel collecteur. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "dealradar-workers" },
});
