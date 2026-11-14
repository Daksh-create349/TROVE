import pino, { type Logger, type LoggerOptions } from "pino";
import type { AppConfig } from "../config/env";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-televault-token']",
  "res.headers['set-cookie']",
  "apiHash",
  "session",
  "sessionString",
  "password",
  "phoneCode",
  "otp",
];

export function createLogger(config: AppConfig): Logger {
  const options: LoggerOptions = {
    level: config.logLevel,
    base: { service: "televault-backend" },
    redact: {
      paths: REDACT_PATHS,
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (config.logPretty) {
    options.transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        ignore: "pid,hostname,service",
      },
    };
  }

  return pino(options);
}

/** A logger that discards everything; used by unit tests and CLI tools. */
export function createSilentLogger(): Logger {
  return pino({ level: "silent" });
}
