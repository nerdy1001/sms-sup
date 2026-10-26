# 5. Working in this repository

## First time on a machine

1. Install Node.js 22.18 or later. The file `.nvmrc` says 22. Check with `node --version`.
2. In the repository folder run `npm install`. The first person to do this also commits the
   `package-lock.json` it creates; it records the exact versions of every library, and the automatic
   checks refuse to run without it.
3. Run `npm run check`. If it passes, your machine is ready.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Types, rules and tests. Run before every pull request. |
| `npm run typecheck` | Only the TypeScript compiler. |
| `npm run check:rules` | Only the rules robot. |
| `npm test` | Only the tests. |
| `npm run new:module -- <CODE>` | Creates a module. |

## One task, start to finish

1. **Read the task** in the delivery plan (for example RG-01) and, if it exists, the module README.
2. **Branch** from `main`: `feat/rg-01-scholar-record`.
3. **Create the module** if it does not exist: `npm run new:module -- RG`.
4. **Write the test first** for the behaviour, including the failures: wrong input, missing
   permission, empty data, the same request sent twice. Then write the code until it passes.
5. **Put code in the right layer** ([03-modules.md](03-modules.md)).
6. **Run `npm run check`** often, not only at the end. Fix at the cause.
7. **Update the documentation** (below). It is part of done.
8. **Open a pull request** titled `feat(rg): short description`. Tick the checklist.
9. **Merge** when GitHub shows `checks` and `pr-title` green.
10. **Mark the task complete** in the progress log once you have accepted the work. See below.

## Documentation is part of done

Each task changes two kinds of documentation.

1. **A task record**, one file per task in `docs/tasks/`, created when the task is delivered. It says what was
   asked, what was built, how it works, why, how to check it, what was left out, and what comes next.
   Copy `docs/tasks/_template.md`.
2. **The guide**, in `docs/guide/`. If the task changed how something works or added a concept (a new
   kernel building block, a new rule, a new command), the relevant page is updated and the glossary gets
   the new words.

The progress log (`docs/progress.md`) gets a row. The status starts as **Delivered** when the work is
handed over and becomes **Complete** when it is accepted. The documentation check fails if a row has no
record, if a record has no row, or if a link in any Markdown file is dead.

## When the automatic checks fail on GitHub

1. Open the failed step and read the message. It is the same text you see locally.
2. Run `npm run check` locally. It should fail in the same way.
3. Fix it, push, and wait for green. Do not merge around a red check, even alone, even at night.

## Changing a rule

Open a separate pull request that changes only the rule (`tools/rules.config.ts` or the check), its
test and `docs/boundaries.md`, and explains why in the description. If it changes a principle (for
example how zones are separated), add a decision record in `docs/adr/` as well.

## Things never to do

- Commit a secret, a key, a real scholar's data or a `.env` file. A secret that was committed is leaked,
  even after you delete it: rotate it.
- Put personal data in a log, an error message, a test or a screenshot.
- Switch off a check "just for now".
- Add a library without thinking: each is something the Ministry cannot monitor. See CONTRIBUTING.md.
