import { builtinModules } from "node:module";
import ts from "typescript";
import { collectComments } from "../lib/comments.ts";
import { fileExists, listFiles, readText } from "../lib/files.ts";
import { lineOf, parseSource, scanImports } from "../lib/imports.ts";
import { locate } from "../lib/layout.ts";
import { finding, type CheckResult, type Finding, type Suppression } from "../lib/model.ts";
import { applySuppressions } from "../lib/suppressions.ts";
import { rules } from "../rules.config.ts";

/**
 * Rules for the code that runs in a browser (the web applications). The API rules do not fit it: there is
 * no database and no secret here, and everything in it can be read and changed by whoever uses it. What
 * matters instead is what the page can be made to do with the person's session and with what they see.
 * Exceptions are written as `web-ignore: <rule> -- <reason>` and stay visible in every report.
 */

const STORAGE_NAMES = new Set(["localStorage", "sessionStorage", "indexedDB", "caches"]);
const NETWORK_NAMES = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]);
const RAW_HTML_PROPERTIES = new Set(["innerHTML", "outerHTML", "insertAdjacentHTML"]);
const SAFE_URL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "www.w3.org"]);

function webApp(file: string): string | undefined {
  const where = locate(file);
  if (where.kind !== "app" || where.test) return undefined;
  return (rules.webApps as readonly string[]).includes(where.app) ? where.app : undefined;
}

export function checkWeb(root: string): CheckResult {
  const findings: Finding[] = [];
  const suppressions: Suppression[] = [];
  const all = listFiles(root);
  for (const file of all) {
    const app = webApp(file);
    if (app === undefined || !/\.tsx?$/.test(file) || file.endsWith(".d.ts")) continue;
    const result = checkSource(file, app, readText(root, file));
    findings.push(...result.findings);
    suppressions.push(...result.suppressions);
  }
  for (const app of rules.webApps) {
    const page = `apps/${app}/index.html`;
    if (fileExists(root, page)) findings.push(...checkPage(page, readText(root, page)));
  }
  return { findings, suppressions };
}

function checkSource(file: string, app: string, text: string): CheckResult {
  const sourceFile = parseSource(file, text);
  const found: Finding[] = [];
  const report = (rule: string, node: ts.Node, message: string): void => {
    found.push(finding(rule, file, message, lineOf(sourceFile, node)));
  };
  const mayCallOut = file.startsWith(`apps/${app}/src/api/`);

  for (const ref of scanImports(sourceFile).imports) {
    const base = ref.specifier.startsWith("node:") ? ref.specifier.slice(5) : ref.specifier;
    if (ref.specifier.startsWith("node:") || builtinModules.includes(base.split("/")[0] ?? base)) {
      found.push(
        finding(
          "web-node-builtin",
          file,
          `"${ref.specifier}" is a Node module and does not exist in a browser. Code of a web application runs only there.`,
          ref.line,
        ),
      );
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const declaring =
        (ts.isVariableDeclaration(parent) ||
          ts.isParameter(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isPropertyAssignment(parent) ||
          ts.isBindingElement(parent) ||
          ts.isImportSpecifier(parent)) &&
        parent.name === node;
      if (!declaring && STORAGE_NAMES.has(node.text)) {
        report(
          "web-browser-storage",
          node,
          `"${node.text}" keeps data in the browser, readable by any script on the page and left behind on shared computers. Session state lives in a cookie that the server sets (httpOnly); the interface keeps nothing.`,
        );
      }
      if (!declaring && NETWORK_NAMES.has(node.text) && !mayCallOut) {
        report(
          "web-network-location",
          node,
          `"${node.text}" talks to the network. Every call to the API goes through src/api, so that errors, timeouts and credentials are handled in one place.`,
        );
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "document" && node.name.text === "cookie") {
        report(
          "web-browser-storage",
          node,
          "document.cookie reads and writes cookies from script. The session cookie is httpOnly, so no script ever touches it.",
        );
      }
      if (RAW_HTML_PROPERTIES.has(node.name.text)) {
        report(
          "web-raw-html",
          node,
          `"${node.name.text}" puts text into the page as markup, which is how one unchecked value becomes a script. Render values as React children, which are escaped.`,
        );
      }
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "document" &&
        (node.name.text === "write" || node.name.text === "writeln")
      ) {
        report(
          "web-raw-html",
          node,
          "document.write puts text into the page as markup. Render values as React children, which are escaped.",
        );
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === "dangerouslySetInnerHTML") {
        report(
          "web-raw-html",
          node,
          "dangerouslySetInnerHTML puts text into the page as markup. Render values as React children, which are escaped.",
        );
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "eval" || node.expression.text === "Function")
    ) {
      report("web-raw-html", node, `${node.expression.text} runs text as code, which a strict content security policy forbids.`);
    }
    if (ts.isStringLiteralLike(node)) {
      const url = /^https?:\/\/([^/:?#\s]+|\[[^\]]+\])/i.exec(node.text);
      if (url !== null && !SAFE_URL_HOSTS.has((url[1] ?? "").toLowerCase())) {
        report(
          "web-external-origin",
          node,
          `"${node.text}" names another website. The staff application loads nothing from and sends nothing to any address but its own (its content security policy blocks it).`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Links that open a new tab without noopener give the new page a handle on this one (older browsers).
  const links = (node: ts.Node): void => {
    if (ts.isJsxOpeningLikeElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const named = (name: string): ts.JsxAttribute | undefined =>
        attributes.find((attribute) => ts.isIdentifier(attribute.name) && attribute.name.text === name);
      const target = named("target");
      const targetValue = target?.initializer !== undefined && ts.isStringLiteral(target.initializer) ? target.initializer.text : undefined;
      const rel = named("rel");
      const relValue = rel?.initializer !== undefined && ts.isStringLiteral(rel.initializer) ? rel.initializer.text : "";
      if (targetValue === "_blank" && !/\bnoopener\b/.test(relValue)) {
        found.push(
          finding("web-target-blank", file, 'A link with target="_blank" needs rel="noopener noreferrer".', lineOf(sourceFile, node)),
        );
      }
    }
    ts.forEachChild(node, links);
  };
  links(sourceFile);

  return applySuppressions(file, collectComments(sourceFile), found, "web-ignore");
}

function checkPage(file: string, text: string): Finding[] {
  const found: Finding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (/<script\b(?![^>]*\bsrc=)/i.test(line)) {
      found.push(
        finding(
          "web-html",
          file,
          "An inline script cannot be allowed by a strict content security policy. Put the code in a file.",
          index + 1,
        ),
      );
    }
    if (/<style\b|\sstyle=/i.test(line)) {
      found.push(
        finding(
          "web-html",
          file,
          "Inline styles cannot be allowed by a strict content security policy. Put the styles in the style sheet.",
          index + 1,
        ),
      );
    }
    if (/\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(line)) {
      found.push(
        finding(
          "web-html",
          file,
          "The page loads something from another address. The staff application serves everything it needs itself.",
          index + 1,
        ),
      );
    }
    if (/\son[a-z]+\s*=/i.test(line)) {
      found.push(finding("web-html", file, "An event attribute is an inline script. Attach handlers in code.", index + 1));
    }
  });
  return found;
}
