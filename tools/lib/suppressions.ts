import { finding, type CheckResult, type Finding, type Suppression } from "./model.ts";
import type { SourceComment } from "./comments.ts";

/**
 * Applies written-down exceptions of the form `<tag>: <rule> -- <reason>` to the findings of one
 * file. An exception covers its own line, or the next line when the comment stands alone.
 * Exceptions without a reason of at least 10 characters are themselves findings, and an exception
 * that matches nothing is reported so that it gets removed.
 */
export function applySuppressions(file: string, comments: readonly SourceComment[], found: Finding[], tag: string): CheckResult {
  const pattern = new RegExp(`${tag}:\\s*([a-z-]+)(?:\\s*--\\s*([^*]*))?`);
  const active: { rule: string; reason: string; lines: number[]; line: number; used: boolean }[] = [];
  const extra: Finding[] = [];
  for (const comment of comments) {
    const match = pattern.exec(comment.text);
    if (match === null) continue;
    const reason = (match[2] ?? "").trim();
    if (reason.length < 10) {
      extra.push(
        finding(
          "suppression-reason",
          file,
          `A suppression needs a reason: "${tag}: <rule> -- <reason of at least 10 characters>".`,
          comment.line,
        ),
      );
      continue;
    }
    active.push({
      rule: match[1] ?? "",
      reason,
      line: comment.line,
      lines: comment.ownLine ? [comment.line, comment.line + 1] : [comment.line],
      used: false,
    });
  }

  const kept: Finding[] = [];
  const applied: Suppression[] = [];
  for (const item of found) {
    const suppression = active.find((entry) => entry.rule === item.rule && item.line !== undefined && entry.lines.includes(item.line));
    if (suppression === undefined) {
      kept.push(item);
    } else {
      suppression.used = true;
      applied.push({ rule: item.rule, file, line: suppression.line, reason: suppression.reason });
    }
  }
  for (const entry of active) {
    if (!entry.used) {
      extra.push(
        finding("unused-suppression", file, `This suppression of "${entry.rule}" matches nothing. Remove it.`, entry.line, "warning"),
      );
    }
  }
  return { findings: [...kept, ...extra], suppressions: applied };
}
