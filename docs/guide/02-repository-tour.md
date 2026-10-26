# 2. Repository tour

Every folder and file at the top level, and what it is for. Nothing here is decoration.

```
minesup-sms/
  apps/
    core-api/          the staff application
    portal-api/        the student portal API
  packages/
    contracts/         data shapes shared by both zones
  tools/               the checks, the module generator, their tests
  docs/                this documentation and the reasons behind decisions
  .github/             automatic checks and settings for GitHub
  package.json  tsconfig*.json  .npmrc  .nvmrc  .editorconfig  .gitignore  .gitattributes
  README.md  CONTRIBUTING.md
```

## `apps/`

Two programs. They will be built, tested and deployed separately.

### `apps/core-api`: the staff application

The internal system. Runs only on the Ministry network. Inside, under `src/`:

- `kernel/` is the **toolbox** used by every module: reading configuration, logging, the web server,
  database helpers, encryption, audit hooks. It is empty now; tasks FN-04 to FN-09 fill it. Rule:
  modules may use the kernel, the kernel never uses a module.
- `modules/` holds the **business features**, one folder each (registry, payments, documents and so on).
  None exists yet. You create each with a command (see [03-modules.md](03-modules.md)).

### `apps/portal-api`: the student portal API

The only part reachable from the internet. Same shape as `core-api` (`kernel/` and `modules/`) and the
same rules. It must never import anything from `core-api`.

Each app folder also has a `package.json`, which declares what that app depends on. This matters:
a check refuses code that uses a library the app did not declare.

## `packages/contracts`

When the staff side pushes a scholar's name to the portal, both sides must agree on what that message
looks like. That agreement lives here, as plain data descriptions. It is the **only code both zones
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
| `lib/` | Shared helpers: reading files, finding imports with the TypeScript parser, working out where a file sits. |
| `new-module.ts` | The generator: `npm run new:module -- RG` builds a module in the standard layout. |
| `check-pr-title.ts` | Checks that a pull request title looks like `feat(rg): add scholar identifier`. |
| `test-support/` and `*.test.ts` | The tests of the robot itself. |

## `docs/`

| Path | What it is |
|---|---|
| `README.md` | Index of the documentation and how it is kept up to date. |
| `guide/` | This guide: concepts and explanations. |
| `progress.md` | The list of tasks finished so far. |
| `tasks/` | One record per finished task: what was asked, what was built, how to check it. |
| `boundaries.md` | Every enforced rule with the reason behind it (reference). |
| `architecture/modules.md` | The planned modules and which may depend on which. |
| `adr/` | Decision records: why one repository, why no NestJS, why custom checks. |
| `github-setup.md` | GitHub settings to apply once. |

## `.github/`

| Path | What it is |
|---|---|
| `workflows/ci.yml` | The automatic checks on every pull request: install, types, rules, tests, title. |
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
