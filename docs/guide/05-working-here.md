# 5. Working in this repository

## First time on a machine

1. Install Node.js 22.18 or later. The file `.nvmrc` says 22. Check with `node --version`.
2. In the repository folder run `npm install`. The file `package-lock.json` records the exact versions
   of every library, and the automatic checks refuse to run without it. Commit it if it changes.
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
9. **Merge** when GitHub shows `checks`, `audit`, `secret-history` and `pr-title` green.
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
2. Run `npm run check` locally. It should fail in the same way. (The `audit` and `secret-history` jobs
   have their own commands: `npm run audit:deps` and `npm run scan:secrets`.)
3. Fix it, push, and wait for green. Do not merge around a red check, even alone, even at night.

### If a secret was found

Treat it as leaked, whatever the file or the commit. Change the real password or key first (a deleted
line is still in the history, and anyone with a copy of the repository has it). Then remove it from the
code, and read it from configuration instead. Only after that, deal with the history: if it was a false
alarm, accept it by its id in `security/accepted-risks.json`.

### If the audit blocks everything

A new vulnerability in a library you use can fail every pull request on the same day, because the list
of known vulnerabilities changes without any change to your code. In order of preference: update the
library (the report names the advisory and usually the fixed version), replace it, or accept the risk in
`security/accepted-risks.json` with a reason and a date within 90 days. The file is checked: a vague
reason or an expired date fails the build.

### Dependabot

It opens a pull request when a library has a new version. If it is a patch or minor update and every
check is green, the pipeline merges it by itself. A major update, an update of a 0.x library, or
anything that touches code stays open for you. Read the release notes of a major update before
merging.

## Changing a rule

Open a separate pull request that changes only the rule (`tools/rules.config.ts` or the check), its
test and `docs/boundaries.md`, and explains why in the description. If it changes a principle (for
example how zones are separated), add a decision record in `docs/adr/` as well.

## Things never to do

- Commit a secret, a key, a real scholar's data, a spreadsheet or a `.env` file. A secret that was
  committed is leaked, even after you delete it: rotate it. The checks catch most of these, not all.
- Put personal data in a log, an error message, a test or a screenshot.
- Switch off a check "just for now". If you must accept a risk, write it in `security/accepted-risks.json`
  with a date: it expires by itself.
- Add a library without thinking: each is something the Ministry cannot monitor. See CONTRIBUTING.md.
