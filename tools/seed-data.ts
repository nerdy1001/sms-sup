import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  assertSyntheticDataset,
  EDGE_CASES,
  generateDataset,
  type SyntheticDataset,
} from "../apps/core-api/src/kernel/seed/synthetic-dataset.ts";
import { DEFAULT_SEED } from "../apps/core-api/src/kernel/seed/synthetic-scholars.ts";

/**
 * Writes a synthetic dataset to a JSON file: `npm run seed:data -- --count 500 --seed 1 --out data/demo.json`.
 * The file holds invented people only (see kernel/seed/synthetic-dataset.ts). The default file is ignored by git.
 * Nothing is loaded into a database here: each module loads its own part when its table exists.
 */
export const DEFAULT_OUTPUT = "synthetic-data.json";

export function summarize(dataset: SyntheticDataset): string {
  const lines = [
    `Seed ${dataset.meta.seed}, reference date ${dataset.meta.referenceDate}.`,
    `${dataset.scholars.length} scholars, ${dataset.attaches.length} attaches, ${dataset.institutions.length} institutions.`,
    `${dataset.years.length} academic years, ${dataset.documents.length} documents, ${dataset.phones.length} phone numbers, ${dataset.payments.length} payments.`,
    "Labelled cases:",
    ...EDGE_CASES.map((label) => `  ${label}: ${dataset.scholars.filter((scholar) => scholar.edgeCases.includes(label)).length}`),
  ];
  return lines.join("\n");
}

export function run(argv: readonly string[], write: (text: string) => void): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      count: { type: "string", default: "200" },
      seed: { type: "string", default: String(DEFAULT_SEED) },
      out: { type: "string", default: DEFAULT_OUTPUT },
      force: { type: "boolean", default: false },
    },
    strict: true,
  });
  const dataset = generateDataset({ scholars: Number(values.count), seed: Number(values.seed) });
  assertSyntheticDataset(dataset);
  if (existsSync(values.out) && !values.force) {
    write(`${values.out} already exists. Use --force to replace it.`);
    return 1;
  }
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(dataset, null, 2)}\n`);
  write(`${summarize(dataset)}\nWritten to ${values.out}`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = run(process.argv.slice(2), (text) => console.log(text));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
