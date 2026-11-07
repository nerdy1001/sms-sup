import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkDocs } from "./docs.ts";
import { createProject, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const SECTIONS = [
  "What was asked",
  "What was built",
  "How it works",
  "Why it was done this way",
  "How to check it",
  "Not included and known gaps",
  "What comes next",
];

const record = (id: string, status = "Delivered (2026-10-26)", sections = SECTIONS): string =>
  `# ${id}: Title\n\nStatus: ${status}\n\n${sections.map((section) => `## ${section}\n\nText.\n`).join("\n")}`;

const progress = (...rows: string[]): string =>
  `# Progress\n\n| Task | Title | Milestone | Status | Date | Record |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`;

const row = (id: string, status = "Delivered", date = "2026-10-26", link = `[${id}](tasks/${id}.md)`): string =>
  `| ${id} | Some title | M1-A | ${status} | ${date} | ${link} |`;

function run(files: Record<string, string>): { rule: string; message: string }[] {
  project = createProject(files);
  return checkDocs(project.root).findings.map((item) => ({ rule: item.rule, message: item.message }));
}

test("a project without documentation folders is not checked", () => {
  assert.deepEqual(run({}), []);
});

test("a consistent progress log, record and links pass", () => {
  const findings = run({
    "docs/progress.md": progress(row("FN-01"), row("FN-02", "Complete", "2026-11-02")),
    "docs/tasks/FN-01.md": record("FN-01"),
    "docs/tasks/FN-02.md": record("FN-02", "Complete (2026-11-02)"),
    "docs/tasks/_template.md": "# TASK-ID\n",
    "docs/guide/a.md":
      "See [the other page](b.md#top) and [the web](https://example.com) and `[code](missing.md)`.\n\n```\n[fenced](missing.md)\n```\n",
    "docs/guide/b.md": "# B\n",
  });
  assert.deepEqual(findings, []);
});

describe("task records", () => {
  test("a progress row without a record file", () => {
    const found = run({ "docs/progress.md": progress(row("FN-01")) });
    assert.deepEqual(found.map((item) => item.rule).sort(), ["doc-broken-link", "doc-task-record"]);
    assert.ok(found.some((item) => /does not exist/.test(item.message)));
  });

  test("a record file without a progress row", () => {
    const found = run({ "docs/progress.md": progress(), "docs/tasks/FN-01.md": record("FN-01") });
    assert.match(found[0]?.message ?? "", /no row/);
  });

  test("a task record without a progress log", () => {
    const found = run({ "docs/tasks/FN-01.md": record("FN-01") });
    assert.ok(found.some((item) => /progress log is missing/.test(item.message)));
  });

  test("a record that lacks required sections", () => {
    const found = run({
      "docs/progress.md": progress(row("FN-01")),
      "docs/tasks/FN-01.md": record("FN-01", "Delivered (2026-10-26)", SECTIONS.slice(0, 5)),
    });
    assert.deepEqual(found.map((item) => item.message).sort(), [
      'Missing section "## Not included and known gaps".',
      'Missing section "## What comes next".',
    ]);
  });

  test("a record whose title does not start with the task ID", () => {
    const found = run({
      "docs/progress.md": progress(row("FN-01")),
      "docs/tasks/FN-01.md": record("FN-01").replace("# FN-01", "# Something else"),
    });
    assert.ok(found.some((item) => /first line must be a heading/.test(item.message)));
  });

  test("the status In progress is accepted when the log and the record agree", () => {
    const found = run({
      "docs/progress.md": progress(row("FN-01", "In progress")),
      "docs/tasks/FN-01.md": record("FN-01", "In progress (2026-10-26)"),
    });
    assert.deepEqual(found, []);
  });

  test("a status or date that differs between the log and the record", () => {
    const found = run({ "docs/progress.md": progress(row("FN-01", "Complete", "2026-11-01")), "docs/tasks/FN-01.md": record("FN-01") });
    assert.ok(found.some((item) => /differs from the progress log/.test(item.message)));
  });

  test("an unknown status, a bad date, a missing link and a duplicate row", () => {
    const found = run({
      "docs/progress.md": progress(
        row("FN-01", "Done"),
        row("FN-02", "Delivered", "26/10/2026"),
        row("FN-03", "Delivered", "2026-10-26", "see below"),
        row("FN-03"),
      ),
    });
    const messages = found.map((item) => item.message).join("\n");
    assert.match(messages, /status "Done"/);
    assert.match(messages, /date "26\/10\/2026"/);
    assert.match(messages, /must link to its record/);
    assert.match(messages, /appears twice/);
  });

  test("a record without a status line", () => {
    const found = run({ "docs/progress.md": progress(row("FN-01")), "docs/tasks/FN-01.md": record("FN-01").replace(/Status:.*\n/, "") });
    assert.ok(found.some((item) => /Add a line "Status/.test(item.message)));
  });
});

describe("links", () => {
  test("a link to a file that does not exist", () => {
    const found = run({ "README.md": "See [guide](docs/missing.md).\n" });
    assert.deepEqual(
      found.map((item) => item.rule),
      ["doc-broken-link"],
    );
  });

  test("relative links are resolved from the folder of the file", () => {
    assert.deepEqual(
      run({ "docs/guide/a.md": "[up](../boundaries.md) [dir](../adr/)\n", "docs/boundaries.md": "# B\n", "docs/adr/0001.md": "# A\n" }),
      [],
    );
  });

  test("a link that climbs out of the repository is reported", () => {
    const found = run({ "README.md": "[outside](../../etc/passwd)\n" });
    assert.deepEqual(
      found.map((item) => item.rule),
      ["doc-broken-link"],
    );
  });
});
