import { posix } from "node:path";
import { fileExists, listFiles, readText } from "../lib/files.ts";
import { finding, type CheckResult, type Finding } from "../lib/model.ts";
import { RENDERED, renderCloudInit, TEMPLATE } from "../render-cloud-init.ts";
import { rules } from "../rules.config.ts";

/**
 * Rules for the infrastructure files. They read the files line by line and expect the layout used in
 * this repository (they are not a YAML parser), which is enough to catch the mistakes that matter:
 * floating image versions, ports open to the internet, powerful containers, literal secrets,
 * production names in staging, and a stale generated server file.
 */

const COMPOSE = /(^|\/)compose\.ya?ml$/;
const DOCKERFILE = /(^|\/)Dockerfile$/;
const SHELL = /\.sh$/;
const SECRET_KEY = /(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)/;
const VERSION_TAG = /^v?\d+\.\d+(\.\d+)?([-.][A-Za-z0-9._]+)?$/;

function inScope(file: string): boolean {
  return (file.startsWith("infra/") && /\.(ya?ml|sh)$|Caddyfile$/.test(file)) || DOCKERFILE.test(file);
}

function codeLines(text: string): { line: number; text: string }[] {
  return text.split("\n").map((raw, index) => ({ line: index + 1, text: raw.replace(/(^|\s)#.*$/, "") })).filter((item) => item.text.trim() !== "");
}

export function checkInfra(root: string): CheckResult {
  const findings: Finding[] = [];
  for (const file of listFiles(root).filter(inScope)) {
    const text = readText(root, file);
    const lines = codeLines(text);
    if (COMPOSE.test(file)) checkCompose(file, lines, findings);
    if (DOCKERFILE.test(file)) checkDockerfile(file, lines, findings);
    if (SHELL.test(file)) checkShell(file, text, lines, findings);
    for (const { line, text: code } of lines) {
      for (const pattern of rules.infra.forbiddenReferences) {
        if (pattern.test(code)) findings.push(finding("infra-forbidden-reference", file, `This line refers to production or to real data (${pattern}). Staging holds synthetic data only and has no link to production.`, line));
      }
    }
  }
  checkGeneratedFile(root, findings);
  return { findings, suppressions: [] };
}

function checkImage(file: string, line: number, image: string, findings: Finding[]): void {
  if (rules.infra.localImagePrefixes.some((prefix) => image.startsWith(prefix))) return;
  if (image.includes("@sha256:")) return;
  const afterSlash = image.slice(image.lastIndexOf("/") + 1);
  const tag = afterSlash.includes(":") ? afterSlash.slice(afterSlash.indexOf(":") + 1) : "";
  if (tag === "" || tag === "latest" || !VERSION_TAG.test(tag)) {
    findings.push(finding("infra-image-tag", file, `The image "${image}" has no exact version tag. Use a tag with at least major and minor (for example 17.5-alpine) or a digest, so that a new release never enters without a pull request.`, line));
  }
}

function checkDockerfile(file: string, lines: { line: number; text: string }[], findings: Finding[]): void {
  const stages = new Set<string>();
  for (const { line, text } of lines) {
    const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(text);
    if (from === null) continue;
    const image = from[1] ?? "";
    if (image !== "scratch" && !stages.has(image)) checkImage(file, line, image, findings);
    if (from[2] !== undefined) stages.add(from[2]);
  }
}

function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

function checkCompose(file: string, lines: { line: number; text: string }[], findings: Finding[]): void {
  let block: { key: string; indent: number } | undefined;
  for (const { line, text } of lines) {
    const trimmed = text.trim();
    const image = /^image:\s*["']?([^"'\s]+)["']?$/.exec(trimmed);
    if (image !== null) checkImage(file, line, image[1] ?? "", findings);

    if (/privileged:\s*true/.test(trimmed) || /(network_mode|pid|ipc):\s*["']?host/.test(trimmed) || trimmed.includes("docker.sock")) {
      findings.push(finding("infra-privileged", file, "A container with host access (privileged, host network or process space, or the Docker socket) can take over the server. Remove it.", line));
    }

    const inlineCap = /^cap_add:\s*\[(.*)\]/.exec(trimmed);
    for (const capability of (inlineCap?.[1] ?? "").split(",").map((item) => item.trim().replaceAll(/["']/g, "")).filter((item) => item !== "")) {
      if ((rules.infra.dangerousCapabilities as readonly string[]).includes(capability)) {
        findings.push(finding("infra-capability", file, `The capability ${capability} gives the container far more power than it needs.`, line));
      }
    }

    if (block !== undefined && indentOf(text) <= block.indent && !trimmed.startsWith("- ")) block = undefined;
    if (block !== undefined && indentOf(text) < block.indent) block = undefined;
    const opener = /^(ports|cap_add|environment):\s*$/.exec(trimmed);
    if (opener !== null) {
      block = { key: opener[1] ?? "", indent: indentOf(text) };
      continue;
    }

    if (block?.key === "ports" && trimmed.startsWith("- ")) {
      const mapping = trimmed.slice(2).replaceAll(/["']/g, "");
      if (!/^(\$\{[A-Z_]+\}|127\.0\.0\.1):/.test(mapping)) {
        findings.push(finding("infra-port-binding", file, `The port "${mapping}" has no address. Docker publishes it around the firewall, to the whole internet. Bind it to 127.0.0.1 or to \${TAILSCALE_IP}.`, line));
      }
    }
    if (block?.key === "cap_add" && trimmed.startsWith("- ")) {
      const capability = trimmed.slice(2).trim();
      if ((rules.infra.dangerousCapabilities as readonly string[]).includes(capability)) {
        findings.push(finding("infra-capability", file, `The capability ${capability} gives the container far more power than it needs.`, line));
      }
    }
    if (block?.key === "environment") {
      const entry = /^(?:- )?([A-Z0-9_]+)\s*[:=]\s*(.*)$/.exec(trimmed);
      const key = entry?.[1] ?? "";
      const value = (entry?.[2] ?? "").replaceAll(/["']/g, "").trim();
      if (SECRET_KEY.test(key) && !key.endsWith("_FILE") && value !== "" && !value.startsWith("${")) {
        findings.push(finding("infra-literal-secret", file, `${key} has a value written in the file. Secrets are read from a file on the server (use ${key}_FILE) or from the environment of the deploy.`, line));
      }
    }
    const inlinePorts = /^ports:\s*\[(.*)\]/.exec(trimmed);
    for (const mapping of (inlinePorts?.[1] ?? "").split(",").map((item) => item.trim().replaceAll(/["']/g, "")).filter((item) => item !== "")) {
      if (!/^(\$\{[A-Z_]+\}|127\.0\.0\.1):/.test(mapping)) {
        findings.push(finding("infra-port-binding", file, `The port "${mapping}" has no address. Bind it to 127.0.0.1 or to \${TAILSCALE_IP}.`, line));
      }
    }
  }
}

function checkShell(file: string, text: string, lines: { line: number; text: string }[], findings: Finding[]): void {
  if (!text.includes("set -euo pipefail")) {
    findings.push(finding("infra-script-strict", file, 'Scripts start with "set -euo pipefail", so that a failed step stops the script instead of being ignored.'));
  }
  for (const { line, text: code } of lines) {
    if (/(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/.test(code)) {
      findings.push(finding("infra-pipe-to-shell", file, "Downloading a script and running it in one step runs code nobody has read. Download it, verify it, then run it, or use the signed package repository.", line));
    }
  }
}

function checkGeneratedFile(root: string, findings: Finding[]): void {
  if (!fileExists(root, TEMPLATE)) return;
  const template = readText(root, TEMPLATE);
  if (!/restrict,command="[^"]+"\s+__DEPLOY_PUBLIC_KEY__/.test(template)) {
    findings.push(finding("infra-deploy-key-unrestricted", TEMPLATE, 'The deploy key must be written as: restrict,command="<script>" <key>, so that it can run one script and nothing else.'));
  }
  let expected: string;
  try {
    expected = renderCloudInit(root);
  } catch (error) {
    findings.push(finding("infra-cloud-init-stale", posix.normalize(TEMPLATE), `The template cannot be rendered: ${error instanceof Error ? error.message : "unknown error"}.`));
    return;
  }
  if (!fileExists(root, RENDERED) || readText(root, RENDERED) !== expected) {
    findings.push(finding("infra-cloud-init-stale", RENDERED, "The generated server setup file is out of date. Run npm run render:cloud-init and commit the result."));
  }
}
