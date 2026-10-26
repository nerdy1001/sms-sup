import { fileExists, listDirectories, listEntries, readText } from "./files.ts";

export interface ModuleManifest {
  readonly code: string;
  readonly name: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly database: {
    readonly schema: string;
    readonly extraSchemas: readonly string[];
  };
}

export interface ModuleInfo {
  readonly app: string;
  readonly name: string;
  /** Root-relative POSIX directory of the module. */
  readonly dir: string;
  readonly manifest: ModuleManifest | undefined;
  readonly manifestProblems: readonly string[];
  readonly entries: readonly string[];
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SNAKE = /^[a-z][a-z0-9_]*$/;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateManifest(raw: unknown): { manifest: ModuleManifest | undefined; problems: string[] } {
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { manifest: undefined, problems: ["module.json must contain a JSON object"] };
  }
  const record = raw as Record<string, unknown>;
  const code = record["code"];
  const name = record["name"];
  const title = record["title"];
  const dependsOn = record["dependsOn"];
  const database = record["database"];

  if (typeof code !== "string" || !/^[A-Z]{2}$/.test(code)) problems.push('"code" must be two capital letters');
  if (typeof name !== "string" || !KEBAB.test(name)) problems.push('"name" must be kebab-case');
  if (typeof title !== "string" || title.trim() === "") problems.push('"title" must be a non-empty string');
  if (!isStringArray(dependsOn) || !dependsOn.every((item) => KEBAB.test(item))) {
    problems.push('"dependsOn" must be a list of module names (kebab-case)');
  }
  let schema: unknown;
  let extraSchemas: unknown;
  if (typeof database !== "object" || database === null) {
    problems.push('"database" must be an object with "schema" and "extraSchemas"');
  } else {
    schema = (database as Record<string, unknown>)["schema"];
    extraSchemas = (database as Record<string, unknown>)["extraSchemas"];
    if (typeof schema !== "string" || !SNAKE.test(schema)) problems.push('"database.schema" must be snake_case');
    if (!isStringArray(extraSchemas) || !extraSchemas.every((item) => SNAKE.test(item))) {
      problems.push('"database.extraSchemas" must be a list of snake_case schema names');
    }
  }
  if (problems.length > 0) return { manifest: undefined, problems };
  return {
    manifest: {
      code: code as string,
      name: name as string,
      title: title as string,
      dependsOn: dependsOn as string[],
      database: { schema: schema as string, extraSchemas: extraSchemas as string[] },
    },
    problems,
  };
}

export function discoverModules(root: string): ModuleInfo[] {
  const modules: ModuleInfo[] = [];
  for (const app of listDirectories(root, "apps")) {
    const modulesDir = `apps/${app}/src/modules`;
    for (const name of listDirectories(root, modulesDir)) {
      const dir = `${modulesDir}/${name}`;
      let manifest: ModuleManifest | undefined;
      let problems: string[] = [];
      if (!fileExists(root, `${dir}/module.json`)) {
        problems = ["module.json is missing"];
      } else {
        try {
          const result = validateManifest(JSON.parse(readText(root, `${dir}/module.json`)));
          manifest = result.manifest;
          problems = result.problems;
        } catch {
          problems = ["module.json is not valid JSON"];
        }
      }
      modules.push({ app, name, dir, manifest, manifestProblems: problems, entries: listEntries(root, dir) });
    }
  }
  return modules;
}
