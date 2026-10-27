import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readText } from "./lib/files.ts";

export const TEMPLATE = "infra/staging/cloud-init.template.yaml";
export const RENDERED = "infra/staging/cloud-init.yaml";

/**
 * Builds the file that is pasted into the "User data" box of the server. The scripts live once, in
 * infra/staging/bin, and are copied into the template where a line says {{file:path}}.
 */
export function renderCloudInit(root: string): string {
  const template = readText(root, TEMPLATE);
  return template
    .split("\n")
    .flatMap((line) => {
      const match = /^( *)\{\{file:([^}]+)\}\}$/.exec(line);
      if (match === null) return [line];
      const indent = match[1] ?? "";
      const content = readText(root, match[2] ?? "").replace(/\n$/, "");
      return content.split("\n").map((text) => (text === "" ? "" : `${indent}${text}`));
    })
    .join("\n");
}

function main(): void {
  const root = resolve(".");
  writeFileSync(resolve(root, RENDERED), renderCloudInit(root));
  console.log(`Wrote ${RENDERED}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
