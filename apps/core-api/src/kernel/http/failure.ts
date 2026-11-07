import type { Problem } from "@minesup/contracts";
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "fastify-type-provider-zod";
import { AppError, isAppError, validationFailed, type ErrorCode, type FieldProblem } from "../errors/app-error.ts";
import { problemFromStatus, toProblem } from "../errors/problem.ts";

/** What the framework says about a failure that it detected itself, before or around our code. */
interface FrameworkError {
  readonly statusCode?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
}

export interface Failure {
  readonly problem: Problem;
  /** True for a bug or an outage that someone has to look at (written to the log as an error). */
  readonly unexpected: boolean;
  /** The error to describe in the log. */
  readonly error: unknown;
}

const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  400: "validation_failed",
  404: "not_found",
  405: "method_not_allowed",
  413: "payload_too_large",
  415: "unsupported_media_type",
  429: "rate_limited",
};

/** One entry of `error.validation`, as made by fastify-type-provider-zod: the kind of issue and where it is. */
interface ValidationEntry {
  readonly keyword?: unknown;
  readonly instancePath?: unknown;
}

/**
 * Only the position and the kind of the problem. The value that was sent is never repeated, and neither
 * is the text of the zod message or its other fields (they can name expected and received values).
 */
function fieldProblems(error: { validation: readonly ValidationEntry[]; validationContext?: unknown }): FieldProblem[] {
  const place = typeof error.validationContext === "string" ? error.validationContext : "request";
  return error.validation.map((entry) => {
    const segments = typeof entry.instancePath === "string" ? entry.instancePath.split("/").filter((segment) => segment !== "") : [];
    return { path: [place, ...segments].join("."), code: typeof entry.keyword === "string" ? entry.keyword : "invalid" };
  });
}

/** Turns anything that was thrown into the answer for the caller, and says whether it is a bug. */
export function classify(error: unknown, requestId: string): Failure {
  if (isAppError(error)) return { problem: toProblem(error, requestId), unexpected: error.status >= 500, error };

  if (hasZodFastifySchemaValidationErrors(error)) {
    const wrapped = validationFailed(fieldProblems(error));
    return { problem: toProblem(wrapped, requestId), unexpected: false, error };
  }

  // A response that does not match its own schema is our bug, never the caller's.
  if (isResponseSerializationError(error)) return { problem: problemFromStatus(500, requestId), unexpected: true, error };

  // Errors of the web framework (unreadable JSON, a body that is too large, a content type it cannot read, the rate limit).
  const framework = error as FrameworkError | null;
  const status = typeof framework?.statusCode === "number" ? framework.statusCode : undefined;
  const code = status === undefined ? undefined : STATUS_TO_CODE[status];
  if (status !== undefined && code !== undefined) {
    const known = typeof framework?.code === "string" && framework.code.startsWith("FST_");
    const wrapped = new AppError(
      code,
      known && typeof framework?.message === "string" ? framework.message : "The request could not be processed.",
    );
    return { problem: toProblem(wrapped, requestId), unexpected: false, error };
  }

  return { problem: problemFromStatus(500, requestId), unexpected: true, error };
}
