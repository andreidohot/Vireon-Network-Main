import pino from "pino";

export const logger = pino({
  name: "vbos",
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: "vbos",
    version: process.env.npm_package_version
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "headers.authorization",
      "token",
      "accessToken",
      "refreshToken",
      "ADMIN_PANEL_TOKEN",
      "ADMIN_JWT_SECRET",
      "ADMIN_DEFAULT_PASSWORD",
      "DISCORD_TOKEN",
      "LAVALINK_PASSWORD",
      "BACKUP_S3_SECRET_ACCESS_KEY"
    ],
    remove: true
  }
});

export function childLogger(bindings) {
  return logger.child(bindings);
}

export function serializeError(error) {
  if (typeof error === "string") {
    return {
      name: "Error",
      message: error
    };
  }

  return {
    name: error?.name,
    message: error?.message,
    stack: error?.stack
  };
}
