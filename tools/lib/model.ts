export type Severity = "error" | "warning";

export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
}

export function finding(
  rule: string,
  file: string,
  message: string,
  line?: number,
  severity: Severity = "error",
): Finding {
  return { rule, severity, file, line, message };
}

export interface CheckResult {
  readonly findings: Finding[];
  /** Suppressions that were applied, listed so that they stay visible in every report. */
  readonly suppressions: Suppression[];
}

export interface Suppression {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}
