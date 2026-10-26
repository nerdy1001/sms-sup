import ts from "typescript";
import { collectComments } from "../lib/comments.ts";
import { listFiles, readText } from "../lib/files.ts";
import { lineOf, parseSource } from "../lib/imports.ts";
import { locate } from "../lib/layout.ts";
import { finding, type CheckResult, type Finding, type Suppression } from "../lib/model.ts";
import { applySuppressions } from "../lib/suppressions.ts";

/**
 * Static analysis for the security mistakes that matter in a Node API. The rules are few on
 * purpose: each one is precise enough that a finding is almost always real. Exceptions are written
 * as `security-ignore: <rule> -- <reason>` and stay visible in every report.
 */

const SQL_METHODS = new Set(["query", "execute", "unsafe", "raw", "queryRaw", "executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]);
const WEAK_HASHES = new Set(["md4", "md5", "sha1", "sha-1"]);
const WEAK_CIPHER = /ecb|(^|[-_])des|rc2|rc4|blowfish/i;
const SAFE_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "www.w3.org"]);

function inScope(file: string): boolean {
  const where = locate(file);
  return file.endsWith(".ts") && !file.endsWith(".d.ts") && !where.test && (where.kind === "module" || where.kind === "kernel" || where.kind === "app" || where.kind === "package");
}

export function checkSecurity(root: string): CheckResult {
  const findings: Finding[] = [];
  const suppressions: Suppression[] = [];
  for (const file of listFiles(root).filter(inScope)) {
    const result = checkSource(file, readText(root, file));
    findings.push(...result.findings);
    suppressions.push(...result.suppressions);
  }
  return { findings, suppressions };
}

function isDynamicText(node: ts.Expression): boolean {
  if (ts.isTemplateExpression(node)) return true;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return !(ts.isStringLiteralLike(node.left) && ts.isStringLiteralLike(node.right)) || isDynamicText(node.left) || isDynamicText(node.right);
  }
  return false;
}

function stringValue(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function propertyName(node: ts.PropertyAssignment): string | undefined {
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
}

function checkSource(file: string, text: string): CheckResult {
  const sourceFile = parseSource(file, text);
  const found: Finding[] = [];
  const report = (rule: string, node: ts.Node, message: string): void => {
    found.push(finding(rule, file, message, lineOf(sourceFile, node)));
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      const first = node.arguments[0];
      if (ts.isPropertyAccessExpression(callee) && SQL_METHODS.has(name) && first !== undefined && isDynamicText(first)) {
        report("sql-interpolation", node, `The query text passed to "${name}" is built from values. Write the text once and pass the values as parameters ($1, $2).`);
      }
      if (name === "createHash" && WEAK_HASHES.has((stringValue(first) ?? "").toLowerCase())) {
        report("weak-hash", node, "MD5 and SHA-1 are broken for security purposes. Use SHA-256 or better, or argon2 for passwords.");
      }
      if (name === "createHmac" && /^md[45]$/i.test(stringValue(first) ?? "")) {
        report("weak-hash", node, "MD4 and MD5 are broken. Use SHA-256 or better.");
      }
      if (name === "createCipher" || name === "createDecipher") {
        report("weak-cipher", node, `${name} derives its key badly and is removed from Node. Use ${name}iv with a random iv and an authenticated mode such as aes-256-gcm.`);
      }
      if ((name === "createCipheriv" || name === "createDecipheriv") && WEAK_CIPHER.test(stringValue(first) ?? "")) {
        report("weak-cipher", node, "This cipher or mode is weak (ECB, DES, RC2, RC4, Blowfish). Use aes-256-gcm.");
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "RegExp") {
      const first = node.arguments?.[0];
      if (first !== undefined && !ts.isStringLiteralLike(first) && !ts.isRegularExpressionLiteral(first)) {
        report("dynamic-regexp", node, "A pattern built from a variable can be abused to freeze the server (ReDoS) or to change what matches. Escape the value, limit its length, or avoid a regular expression.");
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const key = propertyName(node);
      const value = node.initializer;
      if (key === "rejectUnauthorized" && value.kind === ts.SyntaxKind.FalseKeyword) {
        report("tls-verification-off", node, "Certificate checking is switched off. Fix the certificate chain instead.");
      }
      if ((key === "httpOnly" || key === "secure") && value.kind === ts.SyntaxKind.FalseKeyword) {
        report("cookie-flags", node, `A cookie with ${key}: false can be read by scripts or sent over plain HTTP. Session cookies are always httpOnly and secure.`);
      }
      if (key === "origin" && (stringValue(value) === "*" || value.kind === ts.SyntaxKind.TrueKeyword)) {
        report("cors-open", node, "Every website may call this API from a browser. List the allowed origins.");
      }
    }
    if (ts.isStringLiteralLike(node)) {
      if (node.text.includes("NODE_TLS_REJECT_UNAUTHORIZED")) {
        report("tls-verification-off", node, "NODE_TLS_REJECT_UNAUTHORIZED switches certificate checking off for the whole process.");
      }
      const url = /^http:\/\/([^/:?#\s]+|\[[^\]]+\])/i.exec(node.text);
      if (url !== null && !SAFE_HTTP_HOSTS.has((url[1] ?? "").toLowerCase())) {
        report("insecure-url", node, `"${node.text}" uses plain HTTP. Use HTTPS outside the local machine.`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return applySuppressions(file, collectComments(sourceFile), found, "security-ignore");
}
