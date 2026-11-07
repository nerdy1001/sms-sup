# 2. Repository tour

Every folder and file at the top level, and what it is for. Nothing here is decoration.

```
minesup-sms/
  apps/
    core-api/          the staff application
    portal-api/        the student portal API
  packages/
    contracts/         data shapes shared by both zones
  infra/               the staging server and the local helpers, as code
  tools/               the checks, the module generator, their tests
  docs/                this documentation and the reasons behind decisions
  .github/             automatic checks and settings for GitHub
  security/            accepted-risks.json: risks that are accepted for a limited time
  package.json  tsconfig*.json  .npmrc  .nvmrc  .editorconfig  .gitignore  .gitattributes
  README.md  CONTRIBUTING.md
```

## `apps/`

Two programs. They will be built, tested and deployed separately.

### `apps/core-api`: the staff application

The internal system. Runs only on the Ministry network. Inside, under `src/`:

- `kernel/` is the **toolbox** used by every module. It holds `config` (reads and checks the settings),
  `logging` (the logger, which keeps personal data out), `errors` (the one error format), `http` (the web
  server, the rule that every route declares who may call it, the health routes and the API description),
  `db` (the connection pool, `context.ts` which tells the database who is asking, and the migrations and
  seeds of the platform schema) and `seed` (the generator of synthetic data: scholars, schools, years, payments). Encryption and audit hooks
  arrive with tasks FN-07 and FN-09. Rule: modules may use the kernel, the kernel never uses a module.
- `main.ts` is the entry point; `routes.ts` is the list where each module adds its routes. The `Dockerfile`
  builds the image of staging.
- `modules/` holds the **business features**, one folder each (registry, payments, documents and so on).
  None exists yet. You create each with a command (see [03-modules.md](03-modules.md)).

### `apps/portal-api`: the student portal API

The only part reachable from the internet. Same shape as `core-api` (`kernel/` and `modules/`) and the
same rules. It must never import anything from `core-api`.

### `apps/staff-web`: the staff front end

A Vite and React application that runs in the browser and calls `core-api` through one address. It is built to
static files and has its own `Dockerfile` and `Caddyfile`. Guide 9 explains it; `src/` is toured there.

`core-api` also has a `Dockerfile` (how its image is built for staging, installing its libraries from the lock file) and a `.dockerignore`.

Each app folder also has a `package.json`, which declares what that app depends on. This matters:
a check refuses code that uses a library the app did not declare.

## `infra/`

Everything needed to run the application somewhere other than your editor. Nothing here is application
code.

| Path | What it is |
|---|---|
| `staging/compose.yaml` | The four containers of staging: front door (Caddy), application, database, mail catcher. |
| `staging/Caddyfile` | The front door's settings: HTTPS and where each address goes. |
| `staging/cloud-init.yaml` | The whole server setup, to paste into the droplet creation page. Generated: run `npm run render:cloud-init`, never edit by hand. |
| `staging/cloud-init.template.yaml` | The source of the file above. |
| `staging/bin/` | The scripts that live on the server: deploy and rollback, backup, restore, first-time setup. |
| `local/compose.yaml` | The database (and a mail catcher) for your own computer. See [the local database runbook](../runbooks/local-database.md). |

How to use them is in [the staging runbook](../runbooks/staging.md).

## `packages/contracts`

When the staff side pushes a scholar's name to the portal, both sides must agree on what that message
looks like. That agreement lives here, as plain data descriptions (zod schemas: the error codes, the error shape, the health answers). It is the **only code both zones
may share**, and it may contain no logic, no database and no network code. Think of it as the form
that both offices fill in the same way.

## `tools/`

The robot and its helpers. You will rarely edit it, but you will run it all the time.

| Path | What it is |
|---|---|
| `check.ts` | The entry point of `npm run check:rules`. Runs every check and prints the result. |
| `rules.config.ts` | The rules as data: which zones exist, which modules are planned, where network code is allowed. |
| `checks/imports.ts` | Reads every `import` and checks it against the rules (zones, modules, layers, network, database drivers). |
| `checks/structure.ts` | Checks that every module has the right files, folders and manifest. |
| `checks/sql.ts` | Checks that SQL only touches the module's own database schema. |
| `checks/standards.ts` | Small coding rules (no `any`, no `console.log`, no decimal money) and whitespace. |
| `checks/docs.ts` | Checks that the documentation is complete and its links work (see [../README.md](../README.md)). |
| `checks/security.ts` | Eight security rules for application code (weak hashes, switched-off certificate checks, queries built from values and so on). |
| `checks/secrets.ts`, `lib/secrets.ts` | Finds keys, tokens and passwords in files, and files that must never be committed. |
| `checks/infra.ts` | Ten rules for the files in `infra/` (unpinned images, open ports, powerful containers, passwords in files and so on). |
| `checks/migrations.ts` | Ten rules for the SQL files: row-level security on every table, numbering, repeatable seeds and more. |
| `db/` | The database runner: `cli.ts` (the `npm run db:*` commands), `migrate.ts`, `connection.ts` (talks to PostgreSQL through the `pg` driver), `sql-files.ts`, and the helper that starts a temporary server for the tests. |
| `dev.ts`, `api-docs.ts` | `npm run dev` (starts the API for development) and `npm run api:docs` (writes `docs/api/openapi.json`). |
| `checks/register.ts` | Checks that every library has a row in `docs/dependencies.md`. |
| `render-cloud-init.ts` | Builds `infra/staging/cloud-init.yaml` from its template and the scripts. |
| `checks/dependencies.ts` | Checks that dependencies are pinned, come from the npm registry, and match the lock file rules. |
| `scan-history.ts` | The secret scan over every commit of the history (`npm run scan:secrets`). |
| `audit.ts` | Asks npm about known vulnerabilities and applies the blocking policy (`npm run audit:deps`). |
| `dependabot-policy.ts` | Decides whether an update from Dependabot may merge by itself. |
| `notify-slack.ts` | Posts a failure message to Slack. |
| `lib/` | Shared helpers: reading files, finding imports with the TypeScript parser, working out where a file sits. |
| `new-module.ts` | The generator: `npm run new:module -- RG` builds a module in the standard layout. |
| `check-pr-title.ts` | Checks that a pull request title looks like `feat(rg): add scholar identifier`. |
| `test-support/` and `*.test.ts` | The tests of the robot itself. |

## `docs/`

| Path | What it is |
|---|---|
| `README.md` | Index of the documentation and how it is kept up to date. |
| `guide/` | This guide: concepts and explanations, including how Fastify works here. |
| `progress.md` | The list of tasks finished so far. |
| `tasks/` | One record per finished task: what was asked, what was built, how to check it. |
| `boundaries.md` | Every enforced rule with the reason behind it (reference). |
| `architecture/modules.md` | The planned modules and which may depend on which. |
| `adr/` | Decision records: why one repository, why no NestJS, why custom checks, why Fastify and zod. |
| `dependencies.md` | The register of libraries: what each is for, why it was not written by hand, what to do if it is abandoned. |
| `api/openapi.json` | The generated description of the staff API. Never edit by hand: `npm run api:docs`. |
| `github-setup.md` | GitHub settings to apply once. |
| `runbooks/` | Step-by-step instructions for running things: the staging server and the local database. |

## `.github/`

| Path | What it is |
|---|---|
| `workflows/ci.yml` | The automatic checks on every pull request (install, types, rules, tests, audit, history scan, title), and the deployment to staging after a merge to `main`. |
| `pull_request_template.md` | The checklist shown when you open a pull request. |
| `dependabot.yml` | Weekly automatic pull requests proposing library updates. |

## The root files

| File | What it does |
|---|---|
| `package.json` | Declares the commands (`check`, `test`, `new:module`), the two development dependencies (TypeScript and the Node type definitions) and the three workspaces. A **workspace** is a folder npm treats as part of one connected project, so `apps/core-api` can say it uses `@minesup/contracts` and npm wires it up. |
| `tsconfig.base.json`, `tsconfig.json` | Strict TypeScript settings. Strict means the compiler catches many mistakes before the code runs. |
| `.npmrc` | Install only exact versions, never run the install scripts of libraries (a common route for attacks), and refuse an unsupported Node version. |
| `.nvmrc` | The Node version to use. |
| `.editorconfig`, `.gitattributes` | Same indentation and line endings on every machine. |
| `.gitignore` | Files that must never be committed: `node_modules`, build output, `.env`, keys and certificates. |
| `README.md`, `CONTRIBUTING.md` | The way in, and the working agreement. |
