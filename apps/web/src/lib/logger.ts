import { createLogger, type Logger } from "@freecall/observability";
import { getWebEnv } from "./server-env";

let logger: Logger | null = null;

export function getLogger(): Logger {
  if (logger !== null) return logger;

  const env = getWebEnv();
  logger = createLogger({
    service: "freecall-web",
    environment: env.NODE_ENV,
    version: process.env["NEXT_PUBLIC_COMMIT_SHA"],
    level: env.LOG_LEVEL,
  });
  return logger;
}
