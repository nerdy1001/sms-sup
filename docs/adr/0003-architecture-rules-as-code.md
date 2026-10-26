# 0003. Architecture rules are checked by the repository, not remembered

Status: accepted

## Context

Security here rests on structural facts: the staff application is never reached from outside, the
two zones share no code except data shapes, the database is touched in one place per module, each
module owns its tables. These facts are easy to state and easy to break by accident in month five.
There is one developer, so there is no reviewer to notice.

## Decision

The rules are data in `tools/rules.config.ts` and logic in `tools/checks/`. They run in
`npm run check:rules`, locally and in the pull request workflow, which blocks the merge. Each rule
has a test that builds a small project, breaks the rule on purpose and expects the failure.
`docs/boundaries.md` lists every rule and the reason for it.

The checks use the TypeScript compiler's parser, which is already a development dependency, to read
imports, strings and comments.

## Why not ESLint, Prettier and dependency-cruiser

They are good tools, and a team would normally start with them. They were not used here because
the environment in which this task was built had no access to the npm registry, so they could be
neither installed nor tested, and a boundary check that has never been seen to fail is not a check.
The consequence is project-specific code (about 1,500 lines, with about 700 lines of tests) in place of
several dependencies.

## What is missing, on purpose

- A general-purpose linter (style, unused variables beyond what the compiler reports, many
  hundred other rules) and an automatic formatter. Adding ESLint with `typescript-eslint`, and
  Prettier, is a sensible next step on a machine with registry access; the custom checks do not
  overlap with them except `no-any` and `no-default-export`, which can then be removed from here.
- Secret scanning, dependency auditing and static security analysis: task FN-02.
- Checks on the front-end applications beyond the zone rules: task FN-06.

## Consequences

- Changing an architecture rule is a visible act in a pull request, and a principle change gets a
  decision record.
- The checks are code that must be maintained. They are small, typed and tested.
- Rules that need judgement (is this field personal data? is this query safe?) stay in the review
  checklist of the pull request template.
