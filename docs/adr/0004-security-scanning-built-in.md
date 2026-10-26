# ADR 0004: Security scans written for this project, with the registry-backed parts left to npm

Status: accepted (2026-10-26, task FN-02)

## Context

Task FN-02 asks for dependency, static and secret scans in the pipeline. The usual answer is to add
three products: a dependency scanner, a static analyser such as Semgrep or CodeQL, and a secret scanner
such as gitleaks. Three facts shape the choice here.

- **The repository is private and on the free GitHub plan.** GitHub's own secret scanning, push
  protection and code scanning for private repositories are paid features. Branch protection and rulesets
  are also not available for private repositories on the free plan (confirm this in the settings of the
  repository; GitHub changes its plans from time to time).
- **The environment that built the pipeline cannot reach the npm registry, PyPI or GitHub releases.**
  A scanner that has to be downloaded and pinned by checksum could be written into the workflow but not
  run or tested here, so the first run on GitHub would be the first test.
- **The project already has a tested check runner** (ADR 0003) that reads the code with the TypeScript
  parser. Adding rules to it costs little, and each rule is tested against a fake project.

## Decision

1. **Dependency audit uses `npm audit`**, which already reads the advisory database. A small wrapper
   (`tools/audit.ts`) applies the policy: high and critical advisories in production dependencies block
   the merge, everything else warns. The wrapper fails when npm cannot audit, because a scan that
   silently passes when it cannot work is worse than no scan.
2. **Static analysis is a set of eight security rules** in `tools/checks/security.ts`, built on the same
   parser as the other checks. They cover the mistakes that matter in a Node API: SQL built from values,
   weak hashes and ciphers, switched-off certificate checks, insecure cookies, open CORS, plain HTTP and
   regular expressions built from variables.
3. **Secret scanning is written here** (`tools/lib/secrets.ts`): known key formats, passwords in
   connection addresses, high-entropy values assigned to names such as `token`, forbidden file names
   and data files. It runs on the working tree with `npm run check` and on every commit of the history
   with `npm run scan:secrets`.
4. **Exceptions are written down and expire.** A false alarm in a secret or advisory can be accepted in
   `security/accepted-risks.json` for at most 90 days, with a reason. Code-level exceptions use a
   comment with a reason (`security-ignore`, `secrets-allow`), and every one is listed in every report.
5. **Dependency hygiene is checked as data**: exact versions, registry-only sources, an integrity hash
   for every locked package, `ignore-scripts` and `save-exact` in `.npmrc`.

## Consequences

- The scans can be tested here (about 129 new tests) and do not depend on downloading anything in CI
  except `npm ci`, which the pipeline already did.
- **They are less complete than the dedicated products.** The secret scanner knows about ten key formats
  where gitleaks knows hundreds. The security rules cover eight patterns where Semgrep or CodeQL cover
  thousands. A dedicated scanner finds classes of problems that these rules never will, for example
  data flow from a request to a dangerous call.
- **The thresholds are tuned on test data**, not on real code. Expect to adjust them after the first
  weeks of real code, in a pull request that explains the change.
- **The audit is as good as npm's advisory database.** A vulnerability that is not yet published is
  invisible to it.

## When to revisit

- When the repository moves to a paid plan: switch on GitHub secret scanning with push protection, and
  CodeQL, in addition to these checks. They block a secret before it enters the history, which this
  design cannot do.
- When there is a machine with registry access: add gitleaks and Semgrep as extra jobs, pinned by
  checksum, and compare their findings with these checks for a month before deciding what to remove.
- When the first real module with data handling exists (RG): review whether the security rules need
  data-flow checks for personal data.
