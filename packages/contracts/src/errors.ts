import { z } from "zod";

/**
 * The failures that the API reports, as stable codes. The code is the contract: the front end translates
 * by code (so messages can be French or English) and tests check for it. The list is here, in the shared
 * package, because the staff application and the student portal answer in the same way.
 * What each code means as an HTTP status lives with the application that sends it.
 */
export const ERROR_CODES = [
  "validation_failed",
  "unauthenticated",
  "forbidden",
  "not_found",
  "method_not_allowed",
  "conflict",
  "unsupported_media_type",
  "payload_too_large",
  "rate_limited",
  "internal_error",
  "unavailable",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** One problem found in the input, for example a field that is missing. Never carries the value. */
export const fieldProblemSchema = z.object({
  /** Where the problem is, for example "body.email". */
  path: z.string(),
  /** A stable code such as "required" or "invalid_format". */
  code: z.string(),
});
export type FieldProblem = z.infer<typeof fieldProblemSchema>;

/**
 * The body of every error response, following RFC 9457 (problem details), sent as application/problem+json.
 * There is no stack trace, no query, no file path and no personal data in it.
 */
export const problemSchema = z.object({
  /** A URN that names the kind of problem. Stable: it never changes for a given code. */
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: errorCodeSchema,
  /** A sentence for developers, present only for errors that the application raised on purpose. */
  detail: z.string().optional(),
  /** The same identifier appears in the logs and in the x-request-id response header. */
  requestId: z.string(),
  errors: z.array(fieldProblemSchema).optional(),
});
export type Problem = z.infer<typeof problemSchema>;
