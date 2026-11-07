import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Every request has an identifier that appears in its log lines, in the error body and in the x-request-id header. */
export const REQUEST_ID_HEADER = "x-request-id";

const ACCEPTABLE = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Keeps the identifier that the proxy or the caller sent, so that one request can be followed across
 * services, but only when it is short and made of harmless characters. Anything else would let a caller
 * write what it likes into our logs (line breaks, very long text), so it is replaced by a new one.
 */
export function generateRequestId(request: IncomingMessage): string {
  const sent = request.headers[REQUEST_ID_HEADER];
  return typeof sent === "string" && ACCEPTABLE.test(sent) ? sent : randomUUID();
}
