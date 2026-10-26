# GitHub setup (once)

Settings that cannot live in the repository. Apply them when the repository is created. The names
`checks` and `pr-title` are the job names in `.github/workflows/ci.yml`.

## Account

- Two-factor authentication on your GitHub account, preferably with a passkey or a hardware key.
  This account can change code that handles scholars' bank details: treat it like a bank login.
- Use a separate machine profile or at least a screen lock and disk encryption on every computer that
  holds a clone.

## Repository

- **Private.** The code describes the Ministry's internal system.
- **Code and automation > Rulesets > New branch ruleset** for `main`:
  - Require a pull request before merging. Required approvals: 0 while you are the only developer
    (the checks are the gate); raise it to 1 as soon as there is a second person.
  - Require status checks to pass: `checks` and `pr-title`. Require branches to be up to date.
  - Block force pushes. Restrict deletions.
  - Require linear history.
  - Do not allow bypass, including for administrators. A rule you can switch off at midnight is a
    habit, not a rule.
- **General > Pull Requests**: allow squash merging only; default commit message "Pull request title";
  automatically delete head branches.
- **Actions > General**: allow GitHub-owned actions and the ones named in the workflow only;
  "Read repository contents" as the default token permission; require approval for workflows from
  outside collaborators.
- **Code security**: enable Dependabot alerts, Dependabot security updates, secret scanning and push
  protection, and private vulnerability reporting.

## Pull request flow

Dependabot opens pull requests titled `chore(deps): ...`; they pass the title check. Read what changed
in a dependency before merging an update, especially its install scripts and its own new
dependencies. Updating a library is a security decision, not housekeeping.

## Secrets

Secrets (database passwords, keys, the mail relay credentials) never go in the repository or in
GitHub Actions secrets for production. Production secrets are held by the secrets vault of task
FN-10. Until then, the workflow needs none.
