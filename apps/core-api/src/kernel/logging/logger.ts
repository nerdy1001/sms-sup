import { pino, type DestinationStream, type Level, type Logger } from "pino";
import { isAppError } from "../errors/app-error.ts";

export type { Logger };

export const REDACTED = "[redacted]";

/**
 * The first rule of the logs is that personal data never reaches them: the code does not log request
 * bodies, headers, query strings, names, e-mail addresses, telephone numbers, bank details or tokens
 * (docs/tasks/FN-05.md explains each choice). Redaction is the second line of defence, for the day
 * someone logs an object by mistake: a field with one of these names is replaced before it is written,
 * wherever it sits in the first four levels of the object.
 */
const SENSITIVE_WORDS = [
  "password",
  "passwd",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "setCookie",
  "apiKey",
  "email",
  "phone",
  "phoneNumber",
  "firstName",
  "lastName",
  "fullName",
  "surname",
  "givenName",
  "dateOfBirth",
  "birthDate",
  "nationalId",
  "passportNumber",
  "iban",
  "accountNumber",
  "bankAccount",
  "address",
];

const snakeCase = (word: string): string => word.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const kebabCase = (word: string): string => snakeCase(word).replaceAll("_", "-");

/** Every spelling that is likely to appear: camelCase, snake_case, kebab-case (for headers) and lowercase. */
export const SENSITIVE_KEYS: readonly string[] = [
  ...new Set(SENSITIVE_WORDS.flatMap((word) => [word, snakeCase(word), kebabCase(word), word.toLowerCase()])),
];

/** Pino paths: `key`, `*.key`, `*.*.key`, `*.*.*.key`. Keys with a dash need the bracket form. */
export const REDACT_PATHS: readonly string[] = SENSITIVE_KEYS.flatMap((key) => {
  const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `["${key}"]`;
  return [name, `*.${name}`, `*.*.${name}`, `*.*.*.${name}`];
});

export interface LoggerSettings {
  readonly level: Level | "silent";
  readonly service: string;
  readonly version: string;
}

const SAFE_ERROR_NAMES = new Set(["TypeError", "RangeError", "ReferenceError", "SyntaxError"]);

interface ErrorLike {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly stack?: unknown;
  readonly cause?: unknown;
}

export interface ErrorFields {
  readonly errorType: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly stack?: string;
  readonly cause?: ErrorFields;
}

/**
 * What to write to the log about a caught error. The message is written only when its source is known
 * to put no data in it: errors raised on purpose (AppError), errors of the web framework (codes that
 * start with FST_) and the errors of the language itself (TypeError and similar). The message of a
 * database error repeats the values of the query, for example the e-mail address that was already
 * taken, so it is left out; the code (the SQL state, such as 23505) says what happened. The stack is
 * kept without its first line, which is the message.
 */
export function errorFields(error: unknown, depth = 0): ErrorFields {
  if (typeof error !== "object" || error === null) return { errorType: typeof error };
  const value = error as ErrorLike;
  const name = typeof value.name === "string" ? value.name : "Error";
  const code = typeof value.code === "string" ? value.code : undefined;
  const messageIsSafe = isAppError(error) || (code?.startsWith("FST_") ?? false) || SAFE_ERROR_NAMES.has(name);

  const frames =
    typeof value.stack === "string"
      ? value.stack
          .split("\n")
          .filter((line) => line.startsWith("    at "))
          .join("\n")
      : "";
  const cause = depth < 2 && value.cause !== undefined ? errorFields(value.cause, depth + 1) : undefined;

  return {
    errorType: name,
    ...(code === undefined ? {} : { errorCode: code }),
    ...(messageIsSafe && typeof value.message === "string" ? { errorMessage: value.message } : {}),
    ...(frames === "" ? {} : { stack: frames }),
    ...(cause === undefined ? {} : { cause }),
  };
}

/** JSON lines on standard output, one per event, with the level as a word and the time in UTC. */
export function createLogger(settings: LoggerSettings, destination?: DestinationStream): Logger {
  const options = {
    level: settings.level,
    base: { service: settings.service, version: settings.version },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label: string) => ({ level: label }) },
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    // A raw error object put under one of these keys is turned into safe fields instead of being written whole.
    serializers: { err: errorFields, error: errorFields },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
