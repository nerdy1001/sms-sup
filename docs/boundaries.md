# Boundaries and coding rules

Every rule below is checked by `npm run check:rules` and by the pull request workflow. A rule that
fails stops the merge. The rules are defined in `tools/rules.config.ts` (data) and
`tools/checks/` (logic), and each one has a test that proves it fails when broken.

The point of these rules is not tidiness. The system holds bank details and identity numbers of
scholars, some of them minors, and its safety depends on a few structural facts staying true. The
checks turn those facts into something a tired developer cannot break by accident.

## Zones

| Rule | What it forbids | Why |
|---|---|---|
| `zone-isolation` | `core-api` and `staff-web` importing `portal-api` or `portal-web`, and the reverse. Web applications importing API applications. Any application importing another. | The two zones run in different places with different exposure. Code that crosses the line today becomes a data path tomorrow. |
| `package-no-app-import` | Shared packages importing application code. | A shared package that knows an application is no longer shared. |
| `contracts-purity` | `packages/contracts` using Node modules, other packages, or libraries other than the allowed schema library. | The contracts are the only code both zones share. It must be data shapes only. |
| `no-deep-package-import` | Importing a package by a path into its source, or with a sub-path. | A package has one public entry. |

## Modules

| Rule | What it forbids | Why |
|---|---|---|
| `module-public-api` | Importing anything of another module except its `index.ts`. | Other modules depend on a small, visible surface, never on internals. |
| `module-declared-dependency` | Importing a module that is not listed in `dependsOn` of `module.json`. | The dependency graph is a plan. Adding an edge is a deliberate, reviewed change. |
| `module-dependencies` | Declared dependencies that point to nothing, to the module itself, or form a cycle. | A cycle means two modules are really one, or an event is missing. |
| `unused-declared-dependency` (warning) | A declared dependency that no code uses. | The plan should not lie. |
| `kernel-isolation` | The kernel importing a module or the entry point. | Modules depend on the kernel, never the reverse. |
| `no-import-app-root` | A module importing `main.ts`. | The entry point wires modules together, not the other way round. |
| `module-planned` | A module folder that is not in the delivery plan, or has a different code. | New modules are decided, not discovered. Add it to the plan first. |
| `module-code-unique` | Two modules of one application with the same code. | Task IDs must be unambiguous. |
| `module-manifest`, `module-layout` | A missing or invalid `module.json`, a missing `index.ts`, `module.ts` or `README.md`, unexpected files at the module root, unknown folders in `internal/`. | Every module looks the same, so any module can be read in the same way. |

## Layers inside a module

| Layer | May import | Must not import |
|---|---|---|
| `domain` | `domain` | everything else, any external library, any Node module |
| `application` | `domain`, `application` | `infrastructure`, `http`, any external library, any Node module |
| `infrastructure` | `domain`, `application`, `infrastructure` | `http` |
| `http` | `domain`, `application`, `http` | `infrastructure` |

Rules: `layer-direction` (the table above, and layers importing the module root) and `layer-purity`
(libraries and Node modules in `domain` and `application`).

Business rules stay testable without a database or a network, and the HTTP layer cannot reach the
database without going through a use case that can check permissions and write the audit trail.

## Network, database and dangerous capabilities

| Rule | What it forbids | Why |
|---|---|---|
| `network-egress` | HTTP, network and mail libraries, and `fetch`, `WebSocket` and similar globals, outside `main.ts`, `kernel/http`, `kernel/net`, and the infrastructure of `sync` and `notifications` (the portal side has its own short list). Web applications are exempt. | The staff application only calls out to the portal and to the mail relay. Limiting where network code can exist keeps that true. |
| `database-driver` | A database driver outside a module's `infrastructure` layer or `kernel/db`. | All SQL lives in one place per module, behind use cases. |
| `forbidden-builtin` | `child_process`, `vm`, `cluster`, `repl`, `inspector`, `wasi`. | An application that never starts programs or runs text as code is much harder to turn against its host. |
| `no-eval` | `eval`, `Function`, timers given a string. | Same reason. |
| `no-computed-import`, `no-require` | `import(expression)` and `require` calls. | A computed import hides a dependency from every check on this page. |

## Database schemas

Each module owns one PostgreSQL schema, named like the module in snake case (`scholar_accounts` for
`scholar-accounts`). The kernel owns `platform` (audit trail, security helpers). The checks read
SQL files and SQL strings in the infrastructure layer.

| Rule | What it forbids |
|---|---|
| `sql-foreign-schema` | Reading, writing or creating anything in another module's schema. Ask the owning module through its public API. A schema listed in `extraSchemas` of `module.json` is allowed, and the reason belongs in the pull request. |
| `sql-unqualified-object` | `create table`, `view`, `sequence`, `type` or `function` without a schema name in a migration. |

The check cannot see SQL built by joining strings from several variables. The task FN-04 query
helper accepts only fixed query text with parameters, which closes that gap.

## Code standards

| Rule | What it forbids | Instead |
|---|---|---|
| `no-any`, `no-non-null`, `no-ts-ignore` | The `any` type, the `!` operator, silencing the type checker (an expect-error directive is allowed with a written reason). | `unknown` and narrowing; a real fix. |
| `no-default-export` | Default exports. | Named exports. |
| `no-console` | `console` in application code. | The kernel logger (FN-05), which keeps personal data out of logs. |
| `no-process-env` | `process.env` outside `kernel/config` and `main.ts`. | Validated configuration. |
| `no-float-money` | `toFixed`, `parseFloat`. | Money is a whole number of the local currency. |
| `no-math-random` | `Math.random`. | `randomInt` or `randomBytes` from `node:crypto`. |
| `undeclared-dependency` | Importing a library that is not in the `dependencies` of the package that uses it, or only in `devDependencies` when used in production code. | Declare it with an exact version. |
| `test-import`, `circular-import`, `unresolved-import` | Production code importing test files, runtime import cycles, imports that do not resolve (including a missing `.ts` extension). | |
| `file-name` | File and folder names that are not lowercase kebab-case. | |
| `whitespace` | Tabs, trailing spaces, Windows line endings, missing or doubled final newline. | |

Tests are exempt from `no-console`, `no-process-env`, `no-float-money`, `no-math-random`,
`network-egress` and `layer-purity`, because tests need to start servers and read the environment,
and they may use libraries listed in `devDependencies`. They are still held to the type rules and to
every other boundary rule.

## Suppressing a rule

A coding standard can be suppressed on one line, with a reason that is written down:

    // standards-ignore: no-any -- the vendor callback has no usable type, see issue 42

The suppression covers its own line, or the next line when the comment stands alone. A suppression
without a reason of at least ten characters is itself an error. A suppression that matches nothing
is a warning. Every suppression in use is printed at the end of each run, so it stays visible in
review.

Architecture rules (zones, modules, layers, network, database, schemas) cannot be suppressed in a
comment. They change in `tools/rules.config.ts` or in a `module.json`, in a pull request that
explains why, and, when a principle changes, in a decision record under `docs/adr`.
