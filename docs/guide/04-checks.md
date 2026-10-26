# 4. The checks: what runs, and how to read it

`npm run check` runs three things in order. It stops being friendly only when something is wrong.

| Step | Command | What it answers |
|---|---|---|
| 1. Types | `npm run typecheck` | Does the TypeScript compiler accept the code, in strict mode? |
| 2. Rules | `npm run check:rules` | Does the code respect the architecture and the coding standards? |
| 3. Tests | `npm test` | Do the tests, including the tests of the checks themselves, pass? |

GitHub runs the same three steps on every pull request.

## How the rules robot works

It does not run your program. It reads your source files as text and uses the TypeScript parser to
find the facts it needs:

1. every `import` line (and where it points),
2. every string (to find SQL),
3. every comment (to find suppressions and forbidden directives),
4. a few forms of code, such as `process.env` or `console.log`.

It compares those facts with the rules in `tools/rules.config.ts` and prints a list. Five parts:

| Part | Looks at | Example of what it catches |
|---|---|---|
| `imports` | Every import | The portal importing staff code. A module reaching into another module's internals. |
| `structure` | Folders and `module.json` files | A module missing `index.ts`. A module that is not in the plan. A dependency cycle. |
| `sql` | SQL files and SQL strings in infrastructure code | A query on another module's tables. A table created without a schema name. |
| `standards` | TypeScript source and text files | `any`, `console.log`, `Math.random`, tabs, trailing spaces. |
| `docs` | The documentation | A finished task without a record. A link to a file that does not exist. |

Run one part only: `node tools/check.ts --only imports,sql`.

## Reading a result

```
error   zone-isolation   apps/portal-api/src/kernel/leak.ts:1
        portal-api must never import code from core-api: they run in different security zones. ...

1 error(s), 0 warning(s), 0 suppression(s).
```

From left to right: the **severity** (`error` blocks the merge, `warning` does not), the **rule name**
(look it up in [../boundaries.md](../boundaries.md) for the reason), the **file and line**, and a sentence
saying what is wrong and usually what to do instead.

## The common failures

| Rule | What it means | What to do |
|---|---|---|
| `zone-isolation` | One zone imported the other. | Move the shared data shape to `packages/contracts`, or rethink the data flow. |
| `module-public-api` | You imported a file inside another module. | Import that module's `index.ts`. If it does not export what you need, add it there on purpose. |
| `module-declared-dependency` | You use a module that `module.json` does not list. | If the dependency is right, add it to `dependsOn` and say why in the pull request. If not, rethink. |
| `layer-direction` | A layer imported one it may not (for example `http` into `infrastructure`). | Go through the `application` layer. |
| `layer-purity` | A library or Node module in `domain` or `application`. | Move the technical code to `infrastructure` and pass the result in. |
| `network-egress` | Network code outside the few allowed places. | Put it in the allowed folder (for example the infrastructure of `sync`), or reconsider why it is needed. |
| `database-driver` | A database library outside `infrastructure` or `kernel/db`. | Move the query into the module's `infrastructure` layer. |
| `sql-foreign-schema` | SQL touching another module's schema. | Call that module's public API instead. |
| `undeclared-dependency` | You import a library that the app's `package.json` does not list. | Add it with an exact version, and say why. |
| `unresolved-import` | The path does not lead to a file. | Fix the path. Relative imports must end in `.ts`. |
| `circular-import` | Two files import each other. | Extract the shared part into a third file. Type-only imports (`import type`) do not count. |
| `no-any`, `no-non-null` | `any` or the `!` operator. | Use `unknown` and check the value. |
| `whitespace` | Tabs, trailing spaces, wrong line endings. | Fix the editor setting; `.editorconfig` already says what is expected. |
| `doc-task-record`, `doc-broken-link` | The documentation is incomplete or has a dead link. | See [../README.md](../README.md). |

## Suppressing a coding rule

Only the small coding standards can be silenced, and only with a written reason:

```
// standards-ignore: no-any -- the vendor callback has no usable type, see issue 42
```

Architecture rules (zones, modules, layers, network, database) cannot be silenced with a comment.
They change in `tools/rules.config.ts` or a `module.json`, in a pull request that explains why.

## Can the robot be wrong?

Yes. Two known limits: it cannot see SQL assembled from several variables (task FN-04 adds a query
helper that closes this), and it judges only what it can read, so it cannot tell whether a field is
personal data. Those judgements stay in the pull request checklist. If a rule blocks something that is
right, do not fight the rule in the middle of a feature. Finish the feature another way, then open a
separate pull request to change the rule.

## Why the tests test the robot

A check that has never been seen failing proves nothing. So each rule has a test that builds a small
fake project in a temporary folder, breaks the rule on purpose, runs the robot and expects the right
complaint. When you change a rule, change its test.
