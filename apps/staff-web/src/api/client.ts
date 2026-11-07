import { problemSchema, type ErrorCode, type FieldProblem } from "@minesup/contracts";

/**
 * The one place where the browser talks to the API. Everything else calls these functions, which is what
 * lets the rest of the application treat a failure as one kind of thing (ApiError) with a code that the
 * message catalogue can translate.
 *
 * Calls go to the same address that served the page (see vite.config.ts and the Caddyfile), carry the
 * session cookie when there is one, and give up after 15 seconds.
 */

export const REQUEST_TIMEOUT_MS = 15_000;

/** A shape that can check data: every schema of packages/contracts has this method. */
export interface Parser<T> {
  parse(input: unknown): T;
}

export type ApiErrorCode = ErrorCode | "network" | "unexpected";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | undefined;
  /** The identifier that also appears in the server log; show it so that support can find the request. */
  readonly requestId: string | undefined;
  readonly fields: readonly FieldProblem[];

  constructor(code: ApiErrorCode, details: { status?: number; requestId?: string; fields?: readonly FieldProblem[] } = {}) {
    super(`API error: ${code}`);
    this.name = "ApiError";
    this.code = code;
    this.status = details.status;
    this.requestId = details.requestId;
    this.fields = details.fields ?? [];
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Turns a failed response into an ApiError. A body that is not a problem document still gives a usable error. */
async function errorFrom(response: Response): Promise<ApiError> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const problem = problemSchema.safeParse(body);
  if (problem.success) {
    return new ApiError(problem.data.code, {
      status: response.status,
      requestId: problem.data.requestId,
      fields: problem.data.errors ?? [],
    });
  }
  return new ApiError("unexpected", { status: response.status, ...(requestId === undefined ? {} : { requestId }) });
}

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export async function request<T>(path: string, parser: Parser<T>, options: RequestOptions = {}): Promise<T> {
  if (!path.startsWith("/")) throw new Error(`API paths start with "/": ${path}`);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: { accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted === true) throw error;
    throw new ApiError("network");
  }
  if (!response.ok) throw await errorFrom(response);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("unexpected", { status: response.status });
  }
  try {
    return parser.parse(data);
  } catch {
    // The server answered with a shape the contract does not describe: a defect on one side or the other.
    throw new ApiError("unexpected", { status: response.status });
  }
}
