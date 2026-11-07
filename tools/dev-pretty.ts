import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * `npm run dev` shows the logs in a readable form when the library pino-pretty is installed, and as
 * plain JSON lines (what staging and production print) when it is not. The application never loads
 * pino-pretty: the development launcher pipes the application's output through it, so there is no
 * code path in the real program that depends on a development library.
 */

export interface Resolver {
  readonly resolve: (specifier: string) => string;
  readonly read: (path: string) => string;
}

const real: Resolver = { resolve: createRequire(import.meta.url).resolve, read: (path) => readFileSync(path, "utf8") };

/** The path of the pino-pretty program, or undefined when the library is not installed. */
export function findPrettyPrinter(resolver: Resolver = real): string | undefined {
  let manifestPath: string;
  try {
    manifestPath = resolver.resolve("pino-pretty/package.json");
  } catch {
    return undefined;
  }
  try {
    const manifest = JSON.parse(resolver.read(manifestPath)) as { bin?: string | Record<string, string> };
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.["pino-pretty"];
    return bin === undefined ? undefined : join(dirname(manifestPath), bin);
  } catch {
    return undefined;
  }
}

/** The options of the readable form: local time, and no process or host numbers that never change in development. */
export const PRETTY_ARGUMENTS: readonly string[] = ["--translateTime", "SYS:HH:MM:ss", "--ignore", "pid,hostname"];

export function wantsPrettyLogs(env: Readonly<Record<string, string | undefined>>): boolean {
  return env["SMS_LOG_PRETTY"] !== "off";
}
