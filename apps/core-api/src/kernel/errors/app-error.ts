/**
 * Every failure that the application reports to a caller is an AppError with a stable code. The code
 * is the contract: the front end translates by code (so messages can be French or English), and a
 * test can check for it. The message is for developers and for the log, never for the end user.
 *
 * Anything that is not an AppError is a bug. It is reported as internal_error, with no detail,
 * because the text of an unexpected error can contain a query, a path or personal data.
 */

import type { ErrorCode, FieldProblem } from "@minesup/contracts";

export type { ErrorCode, FieldProblem };

/** What each code means over HTTP: its status and the title of the problem. The list of codes is in the contracts package. */
export const ERROR_DEFINITIONS: Readonly<Record<ErrorCode, { readonly status: number; readonly title: string }>> = {
  validation_failed: { status: 400, title: "The request is not valid" },
  unauthenticated: { status: 401, title: "Sign-in is required" },
  forbidden: { status: 403, title: "This action is not allowed" },
  not_found: { status: 404, title: "The resource does not exist" },
  method_not_allowed: { status: 405, title: "This method is not allowed" },
  conflict: { status: 409, title: "The request conflicts with the current state" },
  unsupported_media_type: { status: 415, title: "The content type is not supported" },
  payload_too_large: { status: 413, title: "The request is too large" },
  rate_limited: { status: 429, title: "Too many requests" },
  internal_error: { status: 500, title: "An internal error occurred" },
  unavailable: { status: 503, title: "The service is not available" },
};

export interface AppErrorOptions {
  readonly details?: readonly FieldProblem[];
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly FieldProblem[];

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details ?? [];
  }

  get status(): number {
    return ERROR_DEFINITIONS[this.code].status;
  }
}

export const validationFailed = (details: readonly FieldProblem[], message = "The request does not match the expected shape."): AppError =>
  new AppError("validation_failed", message, { details });
export const unauthenticated = (message = "No valid credentials were presented."): AppError => new AppError("unauthenticated", message);
export const forbidden = (message = "The signed-in user may not do this."): AppError => new AppError("forbidden", message);
export const notFound = (message = "No such resource."): AppError => new AppError("not_found", message);
export const conflict = (message: string): AppError => new AppError("conflict", message);
export const unavailable = (message: string, cause?: unknown): AppError =>
  new AppError("unavailable", message, cause === undefined ? {} : { cause });

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
