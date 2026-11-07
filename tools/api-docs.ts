import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describeApi } from "../apps/core-api/src/kernel/http/api-description.ts";
import { moduleRoutes } from "../apps/core-api/src/routes.ts";

/**
 * Writes docs/api/openapi.json, the description of the staff API that front-end developers, the banks
 * and the auditors can read. Run it with `npm run api:docs` after changing a route; the test
 * tools/api-docs.test.ts fails (and so does `npm run check`) when the file is out of date.
 */
export const OPENAPI_PATH = join("docs", "api", "openapi.json");

export async function currentDescription(): Promise<string> {
  return describeApi(moduleRoutes);
}

async function main(): Promise<void> {
  const root = join(import.meta.dirname, "..");
  const file = join(root, OPENAPI_PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await currentDescription());
  console.log(`Wrote ${OPENAPI_PATH}`);
}

if (import.meta.main) await main();
