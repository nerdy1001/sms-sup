import ts from "typescript";
import { listFiles, readText } from "../lib/files.ts";
import { parseSource } from "../lib/imports.ts";
import { snakeCase } from "../lib/layout.ts";
import { discoverModules } from "../lib/modules.ts";
import { finding, type CheckResult, type Finding } from "../lib/model.ts";
import { rules } from "../rules.config.ts";

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_temp"]);

const REFERENCE =
  /\b(?:from|join|into|update|truncate|references|table|view|sequence|function|type)\s+(?:only\s+)?(?:if\s+(?:not\s+)?exists\s+)?"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?/gi;

const CREATE_OBJECT =
  /\bcreate\s+(?:or\s+replace\s+)?((?:unlogged|temporary|temp)\s+)?(?:table|view|materialized\s+view|sequence|type|function|procedure)\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?(\s*\.)?/gi;

const CREATE_SCHEMA = /\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;

/** Replaces SQL comments by spaces, keeping line numbers intact. */
function blankSqlComments(text: string): string {
  const blank = (match: string): string => match.replace(/[^\n]/g, " ");
  return text.replace(/--[^\n]*/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank);
}

interface Fragment {
  readonly text: string;
  readonly line: number;
}

/** The text of every string and template literal in a TypeScript file, except import paths. */
function stringFragments(file: string, text: string): Fragment[] {
  const sourceFile = parseSource(file, text);
  const fragments: Fragment[] = [];
  const add = (node: ts.Node, value: string): void => {
    fragments.push({ text: value, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 });
  };
  const visit = (node: ts.Node): void => {
    const parent: ts.Node | undefined = node.parent;
    const isSpecifier =
      parent !== undefined && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node;
    const isTypeLiteral = parent !== undefined && ts.isLiteralTypeNode(parent);
    if (ts.isStringLiteral(node) && !isSpecifier && !isTypeLiteral) add(node, node.text);
    else if (ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) add(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return fragments;
}

export function checkSql(root: string): CheckResult {
  const findings: Finding[] = [];

  for (const info of discoverModules(root)) {
    const ownSchema = info.manifest?.database.schema ?? snakeCase(info.name);
    const allowed = new Set<string>([
      ownSchema,
      ...(info.manifest?.database.extraSchemas ?? []),
      ...rules.database.sharedSchemas,
      ...SYSTEM_SCHEMAS,
    ]);

    for (const file of listFiles(root, info.dir)) {
      const isSql = file.endsWith(".sql");
      const isInfrastructureCode = file.endsWith(".ts") && file.includes("/internal/infrastructure/");
      if (!isSql && !isInfrastructureCode) continue;

      const fragments: Fragment[] = isSql
        ? [{ text: blankSqlComments(readText(root, file)), line: 1 }]
        : stringFragments(file, readText(root, file));

      for (const fragment of fragments) {
        const lineAt = (index: number): number => fragment.line + (fragment.text.slice(0, index).match(/\n/g)?.length ?? 0);

        for (const match of fragment.text.matchAll(REFERENCE)) {
          const schema = (match[1] ?? "").toLowerCase();
          if (!allowed.has(schema)) {
            findings.push(
              finding(
                "sql-foreign-schema",
                file,
                `Module "${info.name}" reads or writes ${schema}.${match[2] ?? ""}. A module only touches its own schema "${ownSchema}"; ask the owning module through its public API instead.`,
                lineAt(match.index),
              ),
            );
          }
        }

        if (!isSql) continue;

        for (const match of fragment.text.matchAll(CREATE_OBJECT)) {
          const temporary = match[1] !== undefined;
          const qualified = match[3] !== undefined;
          if (!temporary && !qualified) {
            findings.push(
              finding(
                "sql-unqualified-object",
                file,
                `"${match[2] ?? ""}" is created without a schema. Write ${ownSchema}.${match[2] ?? ""}, so that the object cannot land in the wrong schema.`,
                lineAt(match.index),
              ),
            );
          }
        }
        for (const match of fragment.text.matchAll(CREATE_SCHEMA)) {
          const schema = (match[1] ?? "").toLowerCase();
          if (schema !== ownSchema) {
            findings.push(
              finding(
                "sql-foreign-schema",
                file,
                `Module "${info.name}" creates schema "${schema}". A module creates only its own schema "${ownSchema}".`,
                lineAt(match.index),
              ),
            );
          }
        }
      }
    }
  }
  return { findings, suppressions: [] };
}
