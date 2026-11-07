import { z } from "zod";

/**
 * Every setting of the staff application, in one place. Each setting comes from an environment
 * variable. Only this folder and main.ts may read the environment (a check enforces it).
 *
 * Defaults exist for development only: when SMS_ENV is local or test the database is assumed to be
 * the one started by `npm run db:up`. Anywhere else the database settings are required, so a forgotten
 * variable stops the application at start instead of pointing it at the wrong place.
 */

export const ENVIRONMENTS = ["local", "test", "staging", "production"] as const;
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

/** Names of the variables whose value is the path of a file that holds a secret. */
export const SECRET_FILE_VARIABLES = ["DATABASE_PASSWORD_FILE"] as const;

const port = (name: string) =>
  z.coerce
    .number({ error: `${name} must be a whole number between 1 and 65535` })
    .int({ error: `${name} must be a whole number between 1 and 65535` })
    .min(1, { error: `${name} must be a whole number between 1 and 65535` })
    .max(65535, { error: `${name} must be a whole number between 1 and 65535` });

const text = (name: string) =>
  z
    .string({ error: `${name} must be text` })
    .trim()
    .min(1, { error: `${name} must not be empty` })
    .max(255, { error: `${name} is too long` });

/** The variables as they arrive, before defaults are applied. Empty strings count as missing. */
export const environmentSchema = z.object({
  SMS_ENV: z.enum(ENVIRONMENTS, { error: `SMS_ENV must be one of: ${ENVIRONMENTS.join(", ")}` }),
  HOST: text("HOST").default("127.0.0.1"),
  PORT: port("PORT").default(3000),
  // Say "true" only when every request arrives through the reverse proxy of this server (staging, production).
  TRUST_PROXY: z.enum(["true", "false"], { error: "TRUST_PROXY must be true or false" }).default("false"),
  APP_VERSION: text("APP_VERSION").default("dev"),
  LOG_LEVEL: z.enum(LOG_LEVELS, { error: `LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}` }).default("info"),
  DATABASE_HOST: text("DATABASE_HOST").optional(),
  DATABASE_PORT: port("DATABASE_PORT").default(5432),
  DATABASE_NAME: text("DATABASE_NAME").default("sms"),
  DATABASE_USER: text("DATABASE_USER").default("sms_app"),
});

export type RawEnvironment = z.infer<typeof environmentSchema>;
