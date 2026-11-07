import { describeSqlFile, FILE_NAME } from "../db/sql-files.ts";
import { listFiles, readText } from "../lib/files.ts";
import { finding, type CheckResult, type Finding } from "../lib/model.ts";

/**
 * Rules for the SQL files of the database (migrations and seeds). They protect the three promises of
 * the database design: every table is behind row-level security, a migration is applied once and never
 * edited, and the data in seeds is repeatable and synthetic. See docs/boundaries.md.
 */

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_temp"]);

interface Statement {
  readonly text: string;
  readonly line: number;
}

/** Replaces comments by spaces, keeping the line numbers. Quoted text is left alone. */
function blankComments(sql: string): string {
  let out = "";
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    if (rest.startsWith("--")) {
      const end = rest.indexOf("\n");
      const length = end === -1 ? rest.length : end;
      out += " ".repeat(length);
      index += length;
    } else if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      const length = end === -1 ? rest.length : end + 2;
      out += rest.slice(0, length).replace(/[^\n]/g, " ");
      index += length;
    } else if (sql[index] === "'") {
      let end = index + 1;
      while (end < sql.length && !(sql[end] === "'" && sql[end + 1] !== "'")) end += sql[end] === "'" ? 2 : 1;
      out += sql.slice(index, end + 1);
      index = end + 1;
    } else {
      out += sql[index];
      index += 1;
    }
  }
  return out;
}

/** Splits a script into statements at semicolons that are not inside quotes or dollar-quoted bodies. */
export function splitStatements(sql: string): Statement[] {
  const text = blankComments(sql);
  const statements: Statement[] = [];
  let start = 0;
  let index = 0;
  const push = (end: number): void => {
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    if (trimmed !== "") {
      const leading = raw.length - raw.trimStart().length;
      statements.push({ text: trimmed, line: text.slice(0, start + leading).split("\n").length });
    }
  };
  while (index < text.length) {
    const char = text[index];
    if (char === "'") {
      index += 1;
      while (index < text.length && !(text[index] === "'" && text[index + 1] !== "'")) index += text[index] === "'" ? 2 : 1;
      index += 1;
    } else if (char === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(index));
      if (tag === null) {
        index += 1;
      } else {
        const close = text.indexOf(tag[0], index + tag[0].length);
        index = close === -1 ? text.length : close + tag[0].length;
      }
    } else if (char === ";") {
      push(index);
      index += 1;
      start = index;
    } else {
      index += 1;
    }
  }
  push(text.length);
  return statements;
}

const CREATE_TABLE = /^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?/i;
const CREATE_TABLE_ANY = /^create\s+(?:(?:global\s+|local\s+)?(?:temporary|temp)\s+|unlogged\s+)?table\b/i;
const CREATE_OBJECT =
  /^create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view|sequence|type|function|procedure)\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?(\s*\.)?/i;
const REFERENCE =
  /\b(?:from|join|into|update|truncate|references|table|view|sequence|function|type|on)\s+(?:only\s+)?(?:if\s+(?:not\s+)?exists\s+)?"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?/gi;

export function checkMigrations(root: string): CheckResult {
  const findings: Finding[] = [];
  const numbers = new Map<string, { file: string; number: number }[]>();

  for (const file of listFiles(root, "apps")) {
    const described = describeSqlFile(file);
    if (described === undefined) continue;
    const text = readText(root, file);
    const statements = splitStatements(text);

    if (!FILE_NAME.test(described.name)) {
      findings.push(
        finding(
          "migration-name",
          file,
          'Name the file like "0001_short_description.sql": four digits, then lowercase words joined by underscores.',
        ),
      );
    } else {
      const group = `${described.app}/${described.scope}/${described.kind}`;
      const list = numbers.get(group) ?? [];
      list.push({ file, number: Number(described.name.slice(0, 4)) });
      numbers.set(group, list);
    }

    if (described.kind === "seed") {
      for (const statement of statements) {
        if (/^insert\b/i.test(statement.text) && !/\bon\s+conflict\b/i.test(statement.text)) {
          findings.push(
            finding(
              "seed-not-repeatable",
              file,
              "A seed runs every time the data is refreshed. Add `on conflict (...) do nothing` (or `do update`) so that a second run changes nothing.",
              statement.line,
            ),
          );
        }
      }
      continue;
    }

    const rlsEnabled = new Set<string>();
    const rlsForced = new Set<string>();
    for (const statement of statements) {
      const enable =
        /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?\s+enable\s+row\s+level\s+security\b/i.exec(
          statement.text,
        );
      if (enable !== null) rlsEnabled.add(`${(enable[1] ?? "").toLowerCase()}.${(enable[2] ?? "").toLowerCase()}`);
      const force =
        /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?\s+force\s+row\s+level\s+security\b/i.exec(
          statement.text,
        );
      if (force !== null) rlsForced.add(`${(force[1] ?? "").toLowerCase()}.${(force[2] ?? "").toLowerCase()}`);
    }

    for (const statement of statements) {
      const created = CREATE_TABLE.exec(statement.text);
      if (created !== null) {
        const name = `${(created[1] ?? "").toLowerCase()}.${(created[2] ?? "").toLowerCase()}`;
        if (!rlsEnabled.has(name)) {
          findings.push(
            finding(
              "migration-rls-missing",
              file,
              `The table ${name} is created without \`alter table ${name} enable row level security\` in the same file. Without it every role that can read the table reads every row. Add it, and the policies that let the right people in.`,
              statement.line,
            ),
          );
        } else if (!rlsForced.has(name)) {
          findings.push(
            finding(
              "migration-rls-not-forced",
              file,
              `Add \`alter table ${name} force row level security\`. Without it the owner of the table skips every policy.`,
              statement.line,
            ),
          );
        }
      } else if (CREATE_TABLE_ANY.test(statement.text) && !/^create\s+(?:global\s+|local\s+)?(?:temporary|temp)\b/i.test(statement.text)) {
        findings.push(
          finding(
            "migration-unqualified-object",
            file,
            "Write the schema in front of the table name (platform.users), so that it cannot land in the wrong schema.",
            statement.line,
          ),
        );
      }

      if (/^(begin|commit|rollback|start\s+transaction|end|savepoint|release)\b/i.test(statement.text)) {
        findings.push(
          finding(
            "migration-transaction-control",
            file,
            "Do not write begin, commit or rollback. The runner wraps every migration in one transaction together with its record, so a failed migration leaves nothing behind.",
            statement.line,
          ),
        );
      }

      if (/\bgrant\b[\s\S]*\bto\s+public\b/i.test(statement.text)) {
        findings.push(
          finding(
            "migration-grant-public",
            file,
            "Do not grant anything to public: it means every role, including ones created later. Grant to a named role.",
            statement.line,
          ),
        );
      }

      if (
        /^create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(statement.text) &&
        /\bsecurity\s+definer\b/i.test(statement.text) &&
        !/\bset\s+search_path\b/i.test(statement.text)
      ) {
        findings.push(
          finding(
            "migration-security-definer",
            file,
            "A security definer function runs with its owner's rights, so it must fix its search_path (`set search_path = pg_catalog`), or a caller can make it run their own code.",
            statement.line,
          ),
        );
      }

      if (/^(drop\s+(table|schema|column)|truncate|alter\s+table[\s\S]*\bdrop\s+column)\b/i.test(statement.text)) {
        findings.push(
          finding(
            "migration-destructive",
            file,
            "This deletes data for good. Check that a backup exists and that nothing still reads it.",
            statement.line,
            "warning",
          ),
        );
      }

      if (described.scope === "platform") {
        const own = CREATE_OBJECT.exec(statement.text);
        if (own !== null && own[2] === undefined) {
          findings.push(
            finding(
              "migration-unqualified-object",
              file,
              `"${own[1] ?? ""}" is created without a schema. Write platform.${own[1] ?? ""}.`,
              statement.line,
            ),
          );
        }
        for (const match of statement.text.matchAll(REFERENCE)) {
          const schema = (match[1] ?? "").toLowerCase();
          if (schema !== "platform" && !SYSTEM_SCHEMAS.has(schema)) {
            findings.push(
              finding(
                "migration-foreign-schema",
                file,
                `A platform migration touches ${schema}.${match[2] ?? ""}. The kernel owns only the schema "platform".`,
                statement.line,
              ),
            );
          }
        }
      }
    }
  }

  for (const [group, list] of numbers) {
    const sorted = [...list].sort((a, b) => a.number - b.number || a.file.localeCompare(b.file));
    sorted.forEach((item, index) => {
      const expected = index + 1;
      if (item.number !== expected) {
        const duplicate = sorted[index - 1]?.number === item.number;
        findings.push(
          finding(
            "migration-sequence",
            item.file,
            duplicate
              ? `Two files in ${group} share the number ${String(item.number).padStart(4, "0")}. Renumber the newer one.`
              : `The numbers in ${group} must run 0001, 0002, ... without gaps; expected ${String(expected).padStart(4, "0")} here.`,
          ),
        );
      }
    });
  }
  return { findings, suppressions: [] };
}
