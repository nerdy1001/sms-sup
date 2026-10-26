import ts from "typescript";
import { listFiles, readText } from "../lib/files.ts";
import { collectComments, type SourceComment } from "../lib/comments.ts";
import { lineOf, parseSource } from "../lib/imports.ts";
import { locate, type Where } from "../lib/layout.ts";
import { finding, type CheckResult, type Finding, type Suppression } from "../lib/model.ts";
import { applySuppressions } from "../lib/suppressions.ts";
import { rules } from "../rules.config.ts";

const TEXT_EXTENSIONS = [".ts", ".json", ".md", ".yml", ".yaml", ".sql", ".mjs", ".cjs", ".js"];
const TEXT_DOTFILES = [".editorconfig", ".gitignore", ".gitattributes", ".npmrc", ".nvmrc"];

function inStandardsScope(file: string): boolean {
  return file.endsWith(".ts") && !file.endsWith(".d.ts") && /^(apps\/[^/]+\/src|packages\/[^/]+\/src|tools)\//.test(file);
}

function isProductCode(where: Where): boolean {
  return (where.kind === "module" || where.kind === "kernel" || where.kind === "app" || where.kind === "package") && !where.test;
}

function matchesAny(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

export function checkStandards(root: string): CheckResult {
  const findings: Finding[] = [];
  const suppressions: Suppression[] = [];

  for (const file of listFiles(root).filter(inStandardsScope)) {
    const result = checkSourceFile(file, readText(root, file));
    findings.push(...result.findings);
    suppressions.push(...result.suppressions);
  }
  findings.push(...checkWhitespace(root));
  return { findings, suppressions };
}

function checkSourceFile(file: string, text: string): CheckResult {
  const where = locate(file);
  const product = isProductCode(where);
  const app = where.kind === "module" || where.kind === "kernel" || where.kind === "app" ? where.app : undefined;
  const apiApp = app !== undefined && (rules.apiApps as readonly string[]).includes(app);
  const egressAllowed = app !== undefined && matchesAny(file, rules.egress.allowedPaths[app] ?? []);
  const sourceFile = parseSource(file, text);
  const found: Finding[] = [];

  const report = (rule: string, node: ts.Node, message: string): void => {
    found.push(finding(rule, file, message, lineOf(sourceFile, node)));
  };

  const isIdentifier = (node: ts.Node, name: string): boolean => ts.isIdentifier(node) && node.text === name;

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      report("no-any", node, 'The type "any" switches off type checking. Use "unknown" and narrow it.');
    }
    if (ts.isNonNullExpression(node)) {
      report("no-non-null", node, 'The "!" operator hides a possible null. Check the value or restructure the code.');
    }
    if (ts.isExportAssignment(node)) {
      report("no-default-export", node, "Use named exports. Default exports make renaming and searching unreliable.");
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && ts.canHaveModifiers(node)) {
      if (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true) {
        report("no-default-export", node, "Use named exports. Default exports make renaming and searching unreliable.");
      }
    }
    if (ts.isExportSpecifier(node) && node.name.text === "default") {
      report("no-default-export", node, "Use named exports. Default exports make renaming and searching unreliable.");
    }

    if (product) {
      if (ts.isPropertyAccessExpression(node)) {
        if (isIdentifier(node.expression, "console")) {
          report("no-console", node, "Do not use console in application code. Use the logger of the kernel (it keeps personal data out of logs).");
        }
        if (isIdentifier(node.expression, "Math") && node.name.text === "random") {
          report("no-math-random", node, "Math.random is predictable. Use randomInt or randomBytes from node:crypto; if this is certainly not security related, suppress with a reason.");
        }
        if (isIdentifier(node.expression, "process") && node.name.text === "env" && !matchesAny(file, rules.processEnvAllowedPaths)) {
          report("no-process-env", node, "Read configuration only in kernel/config (validated once at start-up), never from process.env directly.");
        }
        if (node.name.text === "toFixed" || (isIdentifier(node.expression, "Number") && node.name.text === "parseFloat")) {
          report("no-float-money", node, "Do not format or parse decimal numbers. Money is a whole number of the local currency; use the money helpers of the kernel.");
        }
        if (apiApp && !egressAllowed && isIdentifier(node.expression, "globalThis") && (rules.egress.globals as readonly string[]).includes(node.name.text)) {
          report("network-egress", node, `"${node.name.text}" opens network connections and is not allowed here (see docs/boundaries.md).`);
        }
      }
      if (ts.isElementAccessExpression(node) && isIdentifier(node.expression, "process") && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "env" && !matchesAny(file, rules.processEnvAllowedPaths)) {
        report("no-process-env", node, "Read configuration only in kernel/config, never from process.env directly.");
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee)) {
          const name = callee.text;
          if (name === "eval" || name === "Function") {
            report("no-eval", node, `${name} runs text as code. It is never needed here.`);
          }
          if (name === "parseFloat") {
            report("no-float-money", node, "Do not parse decimal numbers. Money is a whole number of the local currency.");
          }
          if ((name === "setTimeout" || name === "setInterval") && node.arguments?.[0] !== undefined && ts.isStringLiteralLike(node.arguments[0])) {
            report("no-eval", node, `${name} with a string runs text as code. Pass a function.`);
          }
          if (apiApp && !egressAllowed && (rules.egress.globals as readonly string[]).includes(name)) {
            report("network-egress", node, `"${name}" opens network connections and is not allowed here (see docs/boundaries.md).`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const comments = collectComments(sourceFile);
  checkTypeScriptDirectives(file, comments, found);
  return applySuppressions(file, comments, found, "standards-ignore");
}

function checkTypeScriptDirectives(file: string, comments: readonly SourceComment[], found: Finding[]): void {
  for (const comment of comments) {
    if (/@ts-(ignore|nocheck)\b/.test(comment.text)) {
      found.push(finding("no-ts-ignore", file, "Do not silence the type checker. Fix the type, or use an expect-error directive with a written reason.", comment.line));
    }
    const expectError = /@ts-expect-error([^\n*]*)/.exec(comment.text);
    if (expectError !== null && (expectError[1] ?? "").trim().length < 10) {
      found.push(finding("no-ts-ignore", file, "An expect-error directive needs a reason of at least 10 characters after it.", comment.line));
    }
  }
}

function checkWhitespace(root: string): Finding[] {
  const found: Finding[] = [];
  for (const file of listFiles(root)) {
    const name = file.split("/").pop() ?? file;
    const isText = TEXT_EXTENSIONS.some((extension) => file.endsWith(extension)) || TEXT_DOTFILES.includes(name);
    if (!isText || name === "package-lock.json") continue;
    const text = readText(root, file);
    if (text === "") continue;
    let reported = 0;
    const add = (message: string, line?: number): void => {
      if (reported < 5) found.push(finding("whitespace", file, message, line));
      reported += 1;
    };
    if (text.includes("\r")) add("Windows line endings (CRLF). Use LF.");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (line.includes("\t")) add("Tab character. Use spaces.", index + 1);
      if (/[ \t]+\r?$/.test(line)) add("Trailing whitespace.", index + 1);
    });
    if (!text.endsWith("\n")) add("The file does not end with a newline.");
    else if (text.endsWith("\n\n")) add("The file ends with more than one newline.");
  }
  return found;
}
