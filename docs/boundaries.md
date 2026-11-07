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
| `contracts-purity` | `packages/contracts` using Node modules (its test files may use the test runner and assertions), other packages, or libraries other than the allowed schema library. | The contracts are the only code both zones share. It must be data shapes only. |
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
| `no-console` | `console` in application code. | The kernel logger (`kernel/logging`), which keeps personal data out of logs. |
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

## Security rules

These run on application and package code (not on tests or `tools`).

| Rule | What it forbids | Instead |
|---|---|---|
| `sql-interpolation` | Query text built from values with a template or `+`, passed to `query`, `execute`, `unsafe`, `raw` and similar. | Constant text with parameters ($1, $2). |
| `weak-hash` | `createHash` with MD4, MD5 or SHA-1; `createHmac` with MD4 or MD5. | SHA-256 or better; argon2 for passwords. |
| `weak-cipher` | `createCipher`, `createDecipher`, and ECB, DES, RC2, RC4, Blowfish. | `aes-256-gcm` with a random iv. |
| `dynamic-regexp` | `new RegExp(variable)`. | Escape and limit the input, or avoid a regular expression. |
| `tls-verification-off` | `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED`. | Fix the certificate chain. |
| `cookie-flags` | A cookie with `httpOnly: false` or `secure: false`. | Session cookies are always httpOnly and secure. |
| `cors-open` | `origin: "*"` or `origin: true`. | A list of allowed origins. |
| `insecure-url` | A plain `http://` address except localhost. | HTTPS. |

## Audit log

These are enforced when the application starts, not by the file checks. Details in
[ADR 0009](adr/0009-audit-hooks.md) and [guide 6](guide/06-writing-a-route.md).

| Rule | What it forbids | Instead |
|---|---|---|
| Audit declaration | A route that is not public and changes data (POST, PUT, PATCH, DELETE) without `config: { audit: { action, objectType } }`. | Declare the action, for example `scholar.update`. |
| Public routes | A public route that declares an audit action, or uses `request.transaction`. | Nobody is signed in to be recorded; sign-in itself is handled by AC-01. |
| Recorded or refused | A route that declares an action and answers with success without having recorded it. | Do the work in `request.transaction`. |
| Safe detail | A key that names personal data, or a value that looks like an e-mail address, in the detail of an entry. | Record an identifier or a code. |

## Web applications (front end)

These rules run on code in `apps/*-web` only. Code that runs in a browser can be read and changed by whoever
uses it, so there is no secret and no trust in it. What matters is what the page can be made to do with the
session and with what the person sees. Exceptions are written `web-ignore: <rule> -- <reason>` and stay
visible in every report. The coding standards (no `any`, no default export, no `console`, whitespace) apply
to `.tsx` files too.

| Rule | What it forbids | Instead |
|---|---|---|
| `web-browser-storage` | `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `document.cookie`. | Keep state in memory. The session cookie is set by the API, httpOnly. One decided exception: the language code, in `i18n/language-preference.ts` (ADR 0008, decision 3). |
| `web-raw-html` | `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, and `eval`-style calls. | Let React write the text. |
| `web-network-location` | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` outside `src/api`. | One client (`src/api/client.ts`) makes every call. |
| `web-node-builtin` | Imports of Node modules in browser code. | Nothing in the browser needs them. |
| `web-external-origin` | An address on another origin. | Same-origin calls only. |
| `web-target-blank` | A link that opens a new tab without `rel="noopener noreferrer"`. | Add the attribute. |
| `web-html` | In `index.html`: inline scripts, inline styles, event attributes, and anything loaded from another address. | Files served with the page; the staging policy blocks the rest. |

## Secrets and data files

| Rule | What it forbids | Instead |
|---|---|---|
| `secret-<kind>` (for example `secret-aws-access-key`, `secret-jwt`, `secret-credential-url`, `secret-secret-assignment`) | A key, token, signed token, or password in any text file, and in any commit of the history. | Read it from the environment (kernel configuration) and rotate it if it was ever real. |
| `secret-file` | `.env` files (but not `.env.example`), key and certificate files, private SSH keys. | Keep them outside the repository. |
| `data-file` | Spreadsheets, database files and dumps (error); CSV files (warning). | Synthetic data only (task FN-08, `npm run seed:data`). |

## Dependencies

| Rule | What it forbids | Instead |
|---|---|---|
| `dependency-not-exact` | A version range or tag (`^1.2.0`, `latest`) in a `package.json`. | An exact version. |
| `dependency-source` | A dependency from git, a URL, a file path or an alias. | The npm registry only. |
| `lockfile-source`, `lockfile-integrity` | A locked package from outside the registry, or without an integrity hash. | Regenerate the lock file from the registry. |
| `lockfile-missing` | (Warning.) No `package-lock.json`. | `npm install`, then commit the file. |
| `npmrc-policy` | `.npmrc` without `ignore-scripts=true` and `save-exact=true`. | Restore the settings. |
| `accepted-risk` | A malformed, expired or too long (over 90 days) entry in `security/accepted-risks.json`. | Fix the cause, or decide again with a new date. |

Libraries also need a row in the register, `docs/dependencies.md` (see [ADR 0007](adr/0007-web-framework-and-libraries.md)):

| Rule | What it forbids | Instead |
|---|---|---|
| `register-missing` | A repository with libraries and no `docs/dependencies.md`. | Create the register. |
| `register-unregistered` | A library declared in a `package.json` that has no row in the register. | Add the row in the same pull request. |
| `register-incomplete` | A row with an empty column, or a "what it is for" shorter than twelve characters. | Answer all four questions: what for, why not by hand, if abandoned, where it may be imported. |
| `register-usage` | A row whose "Used by" does not list a workspace that declares the library. | List `root`, `core-api`, `portal-api` or `contracts` as appropriate. |
| `register-stale` | (Warning.) A row for a library that no workspace declares any more. | Remove the row. |

The audit job adds a rule the files cannot show: a high or critical vulnerability in a production
dependency blocks the merge unless it is accepted in `security/accepted-risks.json`.

## Infrastructure

Applies to the files in `infra/`, the `Dockerfile` and `ci.yml`. These rules cannot be suppressed by a comment.

| Rule | What it forbids | Instead |
|---|---|---|
| `infra-image-tag` | An image with no tag, `latest`, or a tag that is not a version (except images built here, `minesup/`). | A version tag. |
| `infra-port-binding` | A published port without an address (Docker then opens it to everyone, around the firewall). | `${TAILSCALE_IP}:443:443` or `127.0.0.1:...`. |
| `infra-privileged` | `privileged`, host network or process namespace, the Docker socket mounted into a container. | Nothing: redesign. |
| `infra-capability` | Adding a dangerous Linux capability. | Drop all, add only what is needed. |
| `infra-literal-secret` | A password or key written into a Compose or server file. | A file generated on the server. |
| `infra-forbidden-reference` | References that break the zone rule (the portal zone, production names) in staging files. | Keep staging to the core zone. |
| `infra-script-strict` | A server script without `set -euo pipefail`. | Add it. |
| `infra-pipe-to-shell` | Downloading and running in one step (`curl` piped into `sh`). | Download, check, then run, or use the package manager. |
| `infra-cloud-init-stale` | `cloud-init.yaml` that differs from what the template and scripts produce. | `npm run render:cloud-init`. |
| `infra-deploy-key-unrestricted` | A deploy key line without `restrict,command=`. | Restore the restriction. |

## Database files (migrations and seeds)

Applies to every `.sql` file in a `migrations` or `seeds` folder (the kernel's in `kernel/db`, each module's
in `internal/infrastructure`). These rules cannot be suppressed by a comment.

| Rule | What it forbids | Instead |
|---|---|---|
| `migration-name` | A file name that is not like `0001_short_description.sql`. | Four digits, then lowercase words joined by underscores. |
| `migration-sequence` | Numbers that do not start at 0001, have a gap, or repeat (counted separately for the platform, each module, migrations and seeds). | Renumber the newer file. |
| `migration-rls-missing` | A table created without `enable row level security` in the same file. | Enable it, and write the policies. |
| `migration-rls-not-forced` | A table with row-level security that is not forced. | `force row level security`, so the owner obeys the policies too. |
| `migration-unqualified-object` | A table, view, function or type created without a schema. | Write the schema in front of the name. |
| `migration-foreign-schema` | A platform migration that touches another schema. | The kernel owns only `platform`. |
| `migration-transaction-control` | `begin`, `commit`, `rollback` and similar. | Nothing: the runner wraps each file in a transaction. |
| `migration-grant-public` | A grant to `public`. | Grant to a named role. |
| `migration-security-definer` | A security definer function without `set search_path`. | Add `set search_path = pg_catalog`. |
| `migration-destructive` | (Warning.) `drop table`, `drop schema`, `drop column`, `truncate`. | Check that a backup exists and nothing reads it. |
| `seed-not-repeatable` | An `insert` in a seed without `on conflict`. | `on conflict (...) do nothing`. |

## Suppressing a rule

A coding standard can be suppressed on one line, with a reason that is written down:

    // standards-ignore: no-any -- the vendor callback has no usable type, see issue 42

The suppression covers its own line, or the next line when the comment stands alone. A suppression
without a reason of at least ten characters is itself an error. A suppression that matches nothing
is a warning. Every suppression in use is printed at the end of each run, so it stays visible in
review.

Security rules use the same form with their own word: `// security-ignore: <rule> -- <reason>`. A value
that only looks like a secret (a documented example) uses `secrets-allow: <rule> -- <reason>` on its
line or the line before, where the rule is the kind without the `secret-` prefix (for example
`aws-access-key`). A false alarm in the history, or an advisory that cannot be fixed yet, is accepted in
`security/accepted-risks.json` for at most 90 days, with a reason of at least 20 characters.

Architecture rules (zones, modules, layers, network, database, schemas) cannot be suppressed in a
comment. They change in `tools/rules.config.ts` or in a `module.json`, in a pull request that
explains why, and, when a principle changes, in a decision record under `docs/adr`.
