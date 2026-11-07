# GitHub setup (once)

Settings that cannot live in the repository. Apply them when the repository is created. The names
`checks`, `audit`, `secret-history` and `pr-title` are the job names in `.github/workflows/ci.yml`.

## Account

- Two-factor authentication on your GitHub account, preferably with a passkey or a hardware key.
  This account can change code that handles scholars' bank details: treat it like a bank login.
- Use a separate machine profile or at least a screen lock and disk encryption on every computer that
  holds a clone.

## Repository

- **Private.** The code describes the Ministry's internal system.
- **Code and automation > Rulesets > New branch ruleset** for `main`. **Plan check first:** on the
  free plan, private repositories cannot use rulesets or branch protection, and the page will say so
  (GitHub changes its plans from time to time, so trust the page over this note). Without it, nothing
  stops a direct push to `main`: the checks run afterwards and Slack tells you. Options: a paid plan,
  or the discipline of working only through pull requests. If the page is available:
  - Require a pull request before merging. Required approvals: 0 while you are the only developer
    (the checks are the gate); raise it to 1 as soon as there is a second person.
  - Require status checks to pass: `checks`, `audit`, `secret-history` and `pr-title`. Require branches
    to be up to date.
  - Block force pushes. Restrict deletions.
  - Require linear history.
  - Do not allow bypass, including for administrators. A rule you can switch off at midnight is a
    habit, not a rule.
- **General > Pull Requests**: allow squash merging only; default commit message "Pull request title";
  automatically delete head branches.
- **Actions > General**: allow GitHub-owned actions and the ones named in the workflow only;
  "Read repository contents" as the default token permission; require approval for workflows from
  outside collaborators.
- **Code security**: enable Dependabot alerts and Dependabot security updates (free for private
  repositories). Secret scanning with push protection and code scanning are paid features for private
  repositories; switch them on if your plan has them, in addition to the checks of this repository.
  Without them, the secret scan of the pipeline runs after a push, so a secret that is pushed must be
  treated as leaked and rotated.

## Slack notifications (task FN-02)

1. In Slack, create an incoming webhook for the channel that should receive failures (Slack's app
   directory, "Incoming Webhooks"). Treat the address as a password.
2. In GitHub: **Settings > Secrets and variables > Actions > New repository secret**. Name:
   `SLACK_WEBHOOK_URL`. Value: the webhook address.
3. Test it: **Actions > audit-schedule > Run workflow**. The message is sent only when a job fails, so
   to see one, temporarily list a made-up failure, or wait for the first real failure.

Without the secret, the notify step prints a note and passes. The script sends only to addresses that
start with `https://hooks.slack.com/services/` or `/workflows/`.

## Database tests (task FN-04)

The `checks` job installs PostgreSQL's programs (`apt-get install postgresql`) and sets `SMS_REQUIRE_DB=yes`,
so the tests that start a temporary database cannot be skipped there. Nothing to configure in GitHub. If the
install step ever fails, the job fails: do not remove the variable to make it pass, because the tests that
protect the row-level security would then be skipped silently.

## Staging deployment (task FN-03)

The job `deploy-staging` needs one secret and two variables, added after the server exists. The steps,
and how to get the values, are in [the staging runbook](runbooks/staging.md), part D.

| Kind | Name | What it is |
|---|---|---|
| Secret | `STAGING_SSH_KEY` | The private deploy key. It can only run the deploy script on the server. |
| Variable | `STAGING_HOST` | The server's public address. The job runs only when this exists. |
| Variable | `STAGING_HOST_KEY` | The server's SSH host key, checked by fingerprint before you save it. |

Do not add an approval step for the deployment unless your plan supports it for private repositories
(GitHub Environments may be a paid feature there); the page tells you.

## Pull request flow

Pull requests from Dependabot, titled `chore(deps): ...` or `ci(deps): ...`, merge by themselves when
every job passes and the update is a patch or a minor update of dependency files only (the rules are in
`tools/dependabot-policy.ts`). Major updates, updates of 0.x packages and anything else stay open for
you. Read what changed in a dependency before merging a major update, especially its install scripts and
its own new dependencies. Updating a library is a security decision, not housekeeping.

Dependabot also proposes new versions of the container images (the Dockerfile and the Compose files). Those
pull requests never merge by themselves. Major versions of `node` and `postgres` are ignored in
`.github/dependabot.yml` because each is a deliberate change (the runtime, and a data migration); the rest you
review one at a time, after the checks are green.

The merge is made by the workflow itself, after the jobs. It needs no setting beyond the permissions
already written in `ci.yml`. If the merge step fails with a permission error, check **Settings > Actions
> General > Workflow permissions** and that no organization policy forbids the permissions the job asks
for.

If a vulnerability blocks every pull request, fix the dependency, or accept the risk for up to 90 days
in `security/accepted-risks.json` with a written reason (see [boundaries.md](boundaries.md)).

## Secrets

Secrets (database passwords, keys, the mail relay credentials) never go in the repository or in
GitHub Actions secrets for production. Production secrets are held by the secrets vault of task
FN-10. Until then, the workflow needs none.
