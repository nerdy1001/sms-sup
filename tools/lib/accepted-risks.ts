import { fileExists, readText } from "./files.ts";
import { finding, type Finding } from "./model.ts";

export const ACCEPTED_RISKS_FILE = "security/accepted-risks.json";
/** The longest period for which a risk can be accepted. After it, the decision is made again. */
export const MAXIMUM_DAYS = 90;
const DAY = 86_400_000;

export interface AcceptedRisk {
  readonly id: string;
  readonly reason: string;
  readonly expires: string;
}

export interface LoadedRisks {
  /** Entries that are valid and not expired, keyed by id. */
  readonly active: ReadonlyMap<string, AcceptedRisk>;
  readonly findings: Finding[];
}

function parseDay(text: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isNaN(time) ? undefined : time;
}

export function loadAcceptedRisks(root: string, today: Date = new Date()): LoadedRisks {
  const active = new Map<string, AcceptedRisk>();
  const findings: Finding[] = [];
  if (!fileExists(root, ACCEPTED_RISKS_FILE)) return { active, findings };

  const problem = (message: string): void => {
    findings.push(finding("accepted-risk", ACCEPTED_RISKS_FILE, message));
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(root, ACCEPTED_RISKS_FILE));
  } catch {
    problem("The file is not valid JSON.");
    return { active, findings };
  }
  const entries = typeof parsed === "object" && parsed !== null && "accepted" in parsed ? (parsed as { accepted: unknown }).accepted : undefined;
  if (!Array.isArray(entries)) {
    problem('Expected an object of the form { "accepted": [ ... ] }.');
    return { active, findings };
  }

  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  entries.forEach((entry: unknown, index) => {
    const label = `Entry ${index + 1}`;
    const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    const expires = typeof record.expires === "string" ? record.expires : "";
    if (id === "") return problem(`${label} has no "id" (an advisory id such as GHSA-xxxx-xxxx-xxxx, or secret:<commit>:<file>:<rule>).`);
    if (reason.length < 20) return problem(`${label} (${id}) needs a reason of at least 20 characters: why the risk is acceptable and what limits it.`);
    const end = parseDay(expires);
    if (end === undefined) return problem(`${label} (${id}) needs "expires" as YYYY-MM-DD.`);
    if (end < startOfToday) return problem(`${label} (${id}) expired on ${expires}. Fix the cause, or decide again and set a new date.`);
    if (end - startOfToday > MAXIMUM_DAYS * DAY) return problem(`${label} (${id}) expires more than ${MAXIMUM_DAYS} days from now. Accept a risk for at most ${MAXIMUM_DAYS} days at a time.`);
    if (active.has(id)) return problem(`${label} repeats the id ${id}.`);
    active.set(id, { id, reason, expires });
  });
  return { active, findings };
}
