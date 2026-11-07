# MINESUP Scholarship Management System

The system used by the Ministry of Higher Education to manage scholars from registration to the end
of their programme: records, documents, yearly commitments, payments and receipts, and a student
portal. The requirements are in the SRS (version 1.2); the architecture and the delivery plan are
kept with it.

This repository is the code. This file is the way in.

## Layout

    apps/
      core-api/        staff application: internal, never exposed to the internet
      portal-api/      student portal API: the only part reachable from the internet
      staff-web/       staff front end (Vite and React, task FN-06)
      portal-web/      (later) student portal front end
    packages/
      contracts/       data shapes shared by both zones, nothing else
    tools/             architecture, coding and security checks, module generator, scans, database runner (tools/db)
    infra/             staging server as code (staging), optional local database and mail catcher (local)
    security/          accepted-risks.json: risks accepted for a limited time
    docs/
      boundaries.md    every enforced rule and the reason for it
      architecture/    module map
      adr/             decision records
      github-setup.md  repository settings to apply once
      runbooks/        steps for running things (the staging server)

Inside an application: `src/kernel` holds technical building blocks, `src/modules/<name>` holds one
business module with the same layout every time (apps/core-api/src/modules/README.md).

## Start

You need Node.js 22.18 or later (`.nvmrc` says 22) and npm.

    npm install      # first time only
    npm run check    # types, architecture, coding, security, secret and dependency rules, tests

| Command | What it does |
|---|---|
| `npm run check` | Everything below, in order. Run it before every pull request. |
| `npm run typecheck` | The TypeScript compiler in strict mode (the API and tools, then the front end). |
| `npm run lint` / `npm run format:check` | ESLint, and whether every `.ts` and `.tsx` file is formatted by Prettier. `npm run format` fixes the layout. |
| `npm run check:rules` | Architecture boundaries, module layout, database schema ownership, coding standards, security rules, secrets, dependency rules, documentation. |
| `npm run audit:deps` | Known vulnerabilities in dependencies (needs internet and the lock file). |
| `npm run scan:secrets` | Secrets in every commit of the history (needs a git repository). |
| `npm test` | All tests: the Node test runner, then Vitest for the front end. |
| `npm run new:module -- <CODE>` | Creates a module with the standard layout. |
| `npm run db:up` / `db:down` | Start or stop the local PostgreSQL (needs Docker). |
| `npm run db:migrate` / `db:status` | Apply the pending database migrations / show what is applied. |
| `npm run db:seed` / `db:reset` | Add the synthetic data / delete the local database and start again. |
| `npm run db:psql` | A SQL prompt on the local database. |

The `db:` commands talk to PostgreSQL through the `pg` driver (the same as the application), so they need the database but not `psql`. On a server, `node tools/db/cli.ts provision` migrates and sets the password of the application role.
| `npm run render:cloud-init` | Rebuilds `infra/staging/cloud-init.yaml` after a change to a staging script. |

`node tools/check.ts --only imports,sql` runs a subset of the rules.

## How work is done

Start with docs/README.md, which explains what the repository does and what each task delivered. Then read CONTRIBUTING.md (a few minutes). The rules that the checks enforce are in docs/boundaries.md.
Decisions that shaped the repository are in docs/adr.

## Status

Task FN-01 (repository, coding standards, module boundary checks) is complete. Task FN-02 (CI
pipeline with dependency, static and secret scans) is complete. Task FN-03 (staging environment as code)
is in progress: the code is delivered, and the staging server still has to be created
(docs/runbooks/staging.md). Task FN-04 (database, migrations, row-level security, seed data) is complete.
Task FN-05 (application skeleton: configuration, logging, errors, the web server, the API description and
the database driver) is complete (2026-11-04), after you ran `npm run dev`. The progress log is docs/progress.md.

## Known gaps

- **Node types are newer than the Node runtime.** `@types/node` is pinned to 26.6.5, the version
  tested here, while `.nvmrc` selects Node 22. The compiler will therefore accept an API that exists
  only in newer Node. Align them when moving to a newer Node line.
- **Parts of the FN-02 pipeline are unconfirmed on GitHub.** The pipeline has run, but the audit against
  the real registry, the Dependabot merge and the Slack message were not confirmed. See
  docs/tasks/FN-02.md.
- **The database ran on your computer once, through Docker (2026-10-28).** All the database tests passed
  against the PostgreSQL 17 container. The staging script tests do not run on Windows and are skipped
  there; GitHub runs them. See docs/tasks/FN-04.md and docs/runbooks/local-database.md.
- **The image of the core application has not been built since FN-05.** It now installs libraries with
  `npm ci`, and the environment that made it cannot build images. The pipeline on GitHub builds it on the
  next push. See docs/tasks/FN-05.md.
- **Staging has never run on a real server.** The scripts, including the new database migration step, were
  tested against a fake Docker, and the image tags are unverified. See docs/tasks/FN-03.md and docs/runbooks/staging.md.
- **Branch protection is probably unavailable** for a private repository on the free plan, so nothing
  stops a direct push to `main`. See docs/github-setup.md.
- **The scans are less complete than dedicated products** (gitleaks, Semgrep, CodeQL). See
  docs/adr/0004.
- **No general linter or formatter yet.** See docs/adr/0003 for why and what to add.
