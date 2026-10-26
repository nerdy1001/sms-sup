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
      staff-web/       (later, task FN-06) staff front end
      portal-web/      (later) student portal front end
    packages/
      contracts/       data shapes shared by both zones, nothing else
    tools/             architecture and coding checks, module generator
    docs/
      boundaries.md    every enforced rule and the reason for it
      architecture/    module map
      adr/             decision records
      github-setup.md  repository settings to apply once

Inside an application: `src/kernel` holds technical building blocks, `src/modules/<name>` holds one
business module with the same layout every time (apps/core-api/src/modules/README.md).

## Start

You need Node.js 22.18 or later (`.nvmrc` says 22) and npm.

    npm install      # first time only: creates package-lock.json, which you then commit
    npm run check    # types, architecture and coding rules, tests

| Command | What it does |
|---|---|
| `npm run check` | Everything below, in order. Run it before every pull request. |
| `npm run typecheck` | The TypeScript compiler in strict mode. |
| `npm run check:rules` | Architecture boundaries, module layout, database schema ownership, coding standards. |
| `npm test` | All tests. |
| `npm run new:module -- <CODE>` | Creates a module with the standard layout. |

`node tools/check.ts --only imports,sql` runs a subset of the rules.

## How work is done

Read CONTRIBUTING.md (a few minutes). The rules that the checks enforce are in docs/boundaries.md.
Decisions that shaped the repository are in docs/adr.

## Status

Task FN-01 (repository, coding standards, module boundary checks) is complete. Next in the plan:
FN-02 (full CI pipeline with dependency, static and secret scans), FN-03 (staging environment),
FN-04 (database), FN-05 (application skeleton).

## Known gaps

- **No lock file yet.** The environment that produced this repository had no access to the npm
  registry. Run `npm install` once and commit the `package-lock.json` it creates; the workflow uses
  `npm ci`, which refuses to run without it.
- **Node types are newer than the Node runtime.** `@types/node` is pinned to 26.6.3, the version
  tested here, while `.nvmrc` selects Node 22. The compiler will therefore accept an API that exists
  only in newer Node. Align them when moving to a newer Node line.
- **The workflow has not run on GitHub.** The checks it calls were run and tested locally; the
  workflow file itself was not. The first pull request will confirm it.
- **No general linter or formatter yet.** See docs/adr/0003 for why and what to add.
