import { posix } from "node:path";
import { fileExists, listFiles, readText } from "../lib/files.ts";
import { finding, type CheckResult, type Finding } from "../lib/model.ts";

const REQUIRED_SECTIONS = [
  "What was asked",
  "What was built",
  "How it works",
  "Why it was done this way",
  "How to check it",
  "Not included and known gaps",
  "What comes next",
];
const STATUSES = ["Delivered", "Complete"];
const TASK_ROW = /^\|\s*([A-Z]{2}-\d{2})\s*\|(.*)\|\s*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Replaces fenced code blocks and inline code by spaces, keeping line numbers intact. */
function blankCode(text: string): string {
  const blank = (match: string): string => match.replace(/[^\n]/g, " ");
  return text.replace(/```[\s\S]*?```/g, blank).replace(/`[^`\n]*`/g, blank);
}

export function checkDocs(root: string): CheckResult {
  const findings: Finding[] = [];
  checkTaskRecords(root, findings);
  checkLinks(root, findings);
  return { findings, suppressions: [] };
}

function checkTaskRecords(root: string, findings: Finding[]): void {
  const taskFiles = listFiles(root, "docs/tasks").filter((file) => file.endsWith(".md") && !(file.split("/").pop() ?? "").startsWith("_"));
  const hasProgress = fileExists(root, "docs/progress.md");
  if (!hasProgress && taskFiles.length === 0) return;

  const rows = new Map<string, { status: string; date: string; line: number }>();
  if (!hasProgress) {
    findings.push(finding("doc-task-record", "docs/progress.md", "The progress log is missing, but task records exist."));
  } else {
    readText(root, "docs/progress.md").split("\n").forEach((text, index) => {
      const match = TASK_ROW.exec(text);
      if (match === null) return;
      const id = match[1] ?? "";
      const cells = (match[2] ?? "").split("|").map((cell) => cell.trim());
      const line = index + 1;
      if (rows.has(id)) {
        findings.push(finding("doc-task-record", "docs/progress.md", `${id} appears twice in the progress log.`, line));
        return;
      }
      const [, milestone = "", status = "", date = "", record = ""] = cells;
      if (cells.length !== 5 || milestone === "") {
        findings.push(finding("doc-task-record", "docs/progress.md", `The row of ${id} needs: task, title, milestone, status, date, record.`, line));
        return;
      }
      if (!STATUSES.includes(status)) {
        findings.push(finding("doc-task-record", "docs/progress.md", `${id} has status "${status}". Use ${STATUSES.join(" or ")}.`, line));
      }
      if (!DATE.test(date)) {
        findings.push(finding("doc-task-record", "docs/progress.md", `${id} has date "${date}". Use YYYY-MM-DD.`, line));
      }
      if (!record.includes(`tasks/${id}.md`)) {
        findings.push(finding("doc-task-record", "docs/progress.md", `${id} must link to its record: [${id}](tasks/${id}.md).`, line));
      }
      rows.set(id, { status, date, line });
    });
  }

  for (const [id, row] of rows) {
    const path = `docs/tasks/${id}.md`;
    if (!fileExists(root, path)) {
      findings.push(finding("doc-task-record", "docs/progress.md", `${id} is in the progress log but ${path} does not exist. Copy docs/tasks/_template.md.`, row.line));
    }
  }

  for (const file of taskFiles) {
    const id = (file.split("/").pop() ?? "").replace(/\.md$/, "");
    const text = readText(root, file);
    const row = rows.get(id);
    if (row === undefined) {
      findings.push(finding("doc-task-record", file, `${id} has a record but no row in docs/progress.md.`));
    }
    if (!text.startsWith(`# ${id}`)) {
      findings.push(finding("doc-task-record", file, `The first line must be a heading that starts with the task ID: "# ${id}: title".`, 1));
    }
    const headings = new Set(text.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3).trim()));
    for (const section of REQUIRED_SECTIONS) {
      if (!headings.has(section)) {
        findings.push(finding("doc-task-record", file, `Missing section "## ${section}".`));
      }
    }
    const statusLine = /^Status:\s*(\w+)\s*\((\d{4}-\d{2}-\d{2})\)/m.exec(text);
    if (statusLine === null) {
      findings.push(finding("doc-task-record", file, 'Add a line "Status: Delivered (YYYY-MM-DD)" or "Status: Complete (YYYY-MM-DD)".'));
    } else if (row !== undefined && (statusLine[1] !== row.status || statusLine[2] !== row.date)) {
      findings.push(finding("doc-task-record", file, `The status here (${statusLine[1]}, ${statusLine[2]}) differs from the progress log (${row.status}, ${row.date}). Keep them the same.`));
    }
  }
}

function checkLinks(root: string, findings: Finding[]): void {
  for (const file of listFiles(root).filter((path) => path.endsWith(".md"))) {
    const text = blankCode(readText(root, file));
    text.split("\n").forEach((lineText, index) => {
      for (const match of lineText.matchAll(LINK)) {
        const target = match[1] ?? "";
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const path = target.split("#")[0]?.split("?")[0] ?? "";
        if (path === "") continue;
        const resolved = posix.normalize(posix.join(posix.dirname(file), path));
        if (resolved.startsWith("..") || !fileExists(root, resolved)) {
          findings.push(finding("doc-broken-link", file, `The link to "${target}" does not lead to a file or folder.`, index + 1));
        }
      }
    });
  }
}
