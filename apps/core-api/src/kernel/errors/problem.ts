import type { Problem } from "@minesup/contracts";
import { ERROR_DEFINITIONS, isAppError, type ErrorCode } from "./app-error.ts";

export type { Problem };

/*
 * The shape of every error response is `problemSchema` in the contracts package (RFC 9457, problem
 * details). The media type is application/problem+json. There is no stack trace, no query, no file path
 * and no personal data in it.
 */

export const PROBLEM_MEDIA_TYPE = "application/problem+json";

export const problemType = (code: ErrorCode): string => `urn:sms:error:${code}`;

/** Builds the response for any thrown value. Unknown errors become internal_error with no detail. */
export function toProblem(error: unknown, requestId: string): Problem {
  if (isAppError(error)) {
    const base = {
      type: problemType(error.code),
      title: ERROR_DEFINITIONS[error.code].title,
      status: error.status,
      code: error.code,
      detail: error.message,
      requestId,
    };
    // Details are only sent for 4xx errors: they describe the caller's input, not our internals.
    return error.details.length > 0 && error.status < 500 ? { ...base, errors: [...error.details] } : base;
  }
  return {
    type: problemType("internal_error"),
    title: ERROR_DEFINITIONS.internal_error.title,
    status: 500,
    code: "internal_error",
    requestId,
  };
}

/** The same body for a problem that the framework found before any route ran (unknown route, wrong method, oversize body). */
export function problemFromStatus(status: number, requestId: string): Problem {
  const code: ErrorCode =
    status === 404
      ? "not_found"
      : status === 405
        ? "method_not_allowed"
        : status === 413
          ? "payload_too_large"
          : status === 415
            ? "unsupported_media_type"
            : status === 429
              ? "rate_limited"
              : status === 400
                ? "validation_failed"
                : status >= 500
                  ? "internal_error"
                  : "validation_failed";
  return { type: problemType(code), title: ERROR_DEFINITIONS[code].title, status, code, requestId };
}
