# 0001. One repository, several deployable parts

Status: accepted

## Context

The system has two security zones. The staff application runs on the Ministry network and is never
exposed. The student portal is reachable from the internet and holds only a minimum of data. Two web
front ends (staff and scholars) and a few shared data shapes complete the picture. One developer
builds all of it.

## Decision

One GitHub repository, organised as npm workspaces:

- `apps/core-api` and `apps/portal-api`, deployed separately, to different zones.
- `apps/staff-web` and `apps/portal-web` when the front ends start (FN-06 and PT).
- `packages/contracts`, the only code both zones share.
- `tools`, the checks and the module generator.

The zones are separated by what each application may import, enforced by `tools`, and by where each
is deployed. They are not separated by repository.

## Why

- One developer: two repositories double the pull requests, the continuous integration set-up and
  the version drift between shared data shapes, for no benefit.
- A change to a data shape and to both sides of it lands in one reviewed change.
- The risk of a single repository (someone importing across zones) is exactly what the boundary
  checks remove, and the checks run on every pull request.
- If the portal is later handled by another team or another supplier, the folder can be moved to its
  own repository; the rule that it imports nothing but `packages/contracts` makes that cheap.

## Consequences

- Access to the repository gives access to both zones' code. The repository is private, with two
  factor authentication on every account (docs/github-setup.md). Secrets never enter it.
- Each application builds and deploys only its own folder and the contracts package.
