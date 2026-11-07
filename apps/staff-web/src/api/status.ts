import { healthSchema, readySchema, type Health, type Ready } from "@minesup/contracts";
import { request } from "./client.ts";

/** Is the application running, and what version? */
export function getHealth(signal?: AbortSignal): Promise<Health> {
  return request("/health", healthSchema, signal === undefined ? {} : { signal });
}

/** Can the application reach its database? Fails with the code "unavailable" when it cannot. */
export function getReady(signal?: AbortSignal): Promise<Ready> {
  return request("/ready", readySchema, signal === undefined ? {} : { signal });
}
