/**
 * Detection of secrets in text. Pure functions only: the checks and the history scanner decide
 * which text to feed them. A report never contains the secret itself, only a masked preview.
 */

export interface SecretHit {
  readonly rule: string;
  readonly description: string;
  readonly preview: string;
}

interface Detector {
  readonly rule: string;
  readonly description: string;
  readonly regex: RegExp;
}

const DETECTORS: readonly Detector[] = [
  { rule: "private-key", description: "a private key", regex: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { rule: "aws-access-key", description: "an AWS access key id", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { rule: "github-token", description: "a GitHub token", regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { rule: "slack-token", description: "a Slack token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { rule: "slack-webhook", description: "a Slack webhook address", regex: /https:\/\/hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9/_-]{20,}/ },
  { rule: "google-api-key", description: "a Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: "stripe-key", description: "a live Stripe key", regex: /\b[sr]k_live_[0-9A-Za-z]{16,}\b/ },
  { rule: "npm-token", description: "an npm access token", regex: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { rule: "jwt", description: "a signed token (JWT)", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

const CREDENTIAL_URL = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s:@/'"]+:([^\s@/'"]+)@/;
const KEYWORD_ASSIGNMENT = /\b[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|auth)[A-Za-z0-9_.-]*["']?\s*[:=]\s*(["'`])([^"'`\s]{12,})\1/i;

const PLACEHOLDER = /^(?:\$|<|\{\{|%|\*+$|x+$|\.\.\.)|\$\{|example|changeme|change-me|placeholder|your[-_ ]|dummy|sample|redacted|xxxx|\*\*\*\*/i;
const COMMON_PASSWORDS = new Set(["password", "pass", "passwd", "secret", "admin", "root", "postgres", "user", "test", "changeme", "example"]);

export function mask(value: string): string {
  return `${value.slice(0, 4)}... (${value.length} characters)`;
}

/** Shannon entropy in bits per character. Random keys score high, words and identifiers score low. */
export function entropy(value: string): number {
  if (value === "") return 0;
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const share = count / value.length;
    bits -= share * Math.log2(share);
  }
  return bits;
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value) || /^(?:process|env|config|secrets?)\./i.test(value);
}

export function scanLine(line: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const detector of DETECTORS) {
    const match = detector.regex.exec(line);
    if (match !== null) hits.push({ rule: detector.rule, description: detector.description, preview: mask(match[0]) });
  }
  const url = CREDENTIAL_URL.exec(line);
  const password = url?.[1];
  if (password !== undefined && !isPlaceholder(password) && !COMMON_PASSWORDS.has(password.toLowerCase())) {
    hits.push({ rule: "credential-url", description: "a password inside a connection address", preview: mask(password) });
  }
  const assignment = KEYWORD_ASSIGNMENT.exec(line);
  const value = assignment?.[2];
  if (value !== undefined && !isPlaceholder(value) && /\d/.test(value) && /[A-Za-z]/.test(value) && entropy(value) >= 3.3 && !hits.some((hit) => hit.rule !== "credential-url")) {
    hits.push({ rule: "secret-assignment", description: "a value that looks like a password, key or token", preview: mask(value) });
  }
  return hits;
}

const ALLOW_MARKER = /secrets-allow:\s*([a-z-]+)\s*--\s*(.*)$/;

export interface AllowedHit {
  readonly line: number;
  readonly rule: string;
  readonly reason: string;
}

export interface TextScan {
  readonly hits: { readonly line: number; readonly hit: SecretHit }[];
  readonly allowed: AllowedHit[];
}

/**
 * Scans a whole text. A line may carry `secrets-allow: <rule> -- <reason>` (reason of at least
 * 10 characters), on the line itself or on the line before it, for a value that only looks like a
 * secret, such as a documented example.
 */
export function scanText(text: string): TextScan {
  const lines = text.split("\n");
  const markers = new Map<number, { rule: string; reason: string }>();
  lines.forEach((line, index) => {
    const match = ALLOW_MARKER.exec(line);
    const reason = (match?.[2] ?? "").trim();
    if (match !== null && reason.length >= 10) markers.set(index + 1, { rule: match[1] ?? "", reason });
  });
  const hits: TextScan["hits"][number][] = [];
  const allowed: AllowedHit[] = [];
  lines.forEach((line, index) => {
    const number = index + 1;
    for (const hit of scanLine(line)) {
      const marker = [markers.get(number), markers.get(number - 1)].find((candidate) => candidate?.rule === hit.rule);
      if (marker === undefined) hits.push({ line: number, hit });
      else allowed.push({ line: number, rule: hit.rule, reason: marker.reason });
    }
  });
  return { hits, allowed };
}

export interface HistoryHit {
  readonly commit: string;
  readonly file: string;
  readonly line: number;
  readonly hit: SecretHit;
}

/**
 * Scans the added lines of `git log -p -U0 --format="commit %H"` output. Every line that ever
 * entered the repository is covered, including lines that were deleted again afterwards.
 */
export function scanDiff(diff: string): HistoryHit[] {
  const found: HistoryHit[] = [];
  const hunkHeader = /^@@ -\S+ \+(\d+)(?:,\d+)? @@/;
  let commit = "";
  let file = "";
  let inHunk = false;
  let lineNumber = 0;
  for (const line of diff.split("\n")) {
    // Inside a hunk every content line starts with "+", "-" or a space, so these headers are unambiguous.
    if (line.startsWith("commit ")) {
      commit = line.slice(7, 14);
      file = "";
      inHunk = false;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    const hunk = hunkHeader.exec(line);
    if (hunk !== null) {
      inHunk = true;
      lineNumber = Number(hunk[1]);
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("+++ ")) file = line.startsWith("+++ b/") ? line.slice(6) : "";
      continue;
    }
    if (line.startsWith("+")) {
      const content = line.slice(1);
      const marker = ALLOW_MARKER.exec(content);
      const reasonLength = (marker?.[2] ?? "").trim().length;
      for (const hit of scanLine(content)) {
        if (marker !== null && marker[1] === hit.rule && reasonLength >= 10) continue;
        found.push({ commit, file, line: lineNumber, hit });
      }
      lineNumber += 1;
    } else if (line.startsWith(" ")) {
      lineNumber += 1;
    }
  }
  return found;
}

export interface FileNameRule {
  readonly rule: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

const SECRET_FILE_NAMES: readonly { readonly pattern: RegExp; readonly result: FileNameRule }[] = [
  { pattern: /(^|\/)\.env(\.(?!example$|sample$|template$)[^/]+)?$/, result: { rule: "secret-file", severity: "error", message: "Environment files hold secrets and never enter the repository. Commit a .env.example without values." } },
  { pattern: /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/, result: { rule: "secret-file", severity: "error", message: "Key and certificate files never enter the repository." } },
  { pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, result: { rule: "secret-file", severity: "error", message: "A private SSH key never enters the repository." } },
  { pattern: /\.(xlsx|xls|ods|dump|bak|sqlite3?|db)$/, result: { rule: "data-file", severity: "error", message: "Spreadsheets, database files and dumps may hold personal data of scholars. Only synthetic data (task FN-08) is committed, as code or plain fixtures." } },
  { pattern: /\.csv$/, result: { rule: "data-file", severity: "warning", message: "A CSV file may hold personal data. Confirm that it is synthetic." } },
];

export function checkFileName(path: string): FileNameRule | undefined {
  return SECRET_FILE_NAMES.find((entry) => entry.pattern.test(path))?.result;
}
