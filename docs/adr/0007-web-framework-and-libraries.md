# ADR 0007: Fastify and zod, and a register for every library

Status: accepted (2026-10-28, task FN-05)

## Context

ADR 0002 chose Node and TypeScript without a framework and left the web server open, with Fastify as the
likely choice. FN-05 had to decide. The staff application holds identity numbers and bank details, and one
person builds and maintains it, so two things matter at once: the security of the request path, and the
amount of code and of third-party software that one person has to understand. The owner's instruction was to
manage complexity before it grows, and to review where a library could replace hand-written Node code.

## Decision

1. **Fastify is the web framework.** Express was the alternative. Fastify checks input and output against
   schemas as part of the framework, removes fields that a response schema does not list, uses Pino natively,
   isolates plugins from one another, and runs without a build step.
2. **zod is the single definition of a data shape.** Settings, requests, answers and the shared contracts are
   zod schemas, so a shape gives the check, the TypeScript type and the API description from one source.
   `fastify-type-provider-zod` connects it to Fastify.
3. **Libraries replace hand-written code where the hand-written version would be security-sensitive or
   long to get right**: the HTTP server, validation, logging, security headers, rate limiting and the
   PostgreSQL driver. Code that carries the project's own rules stays ours (the architecture checks, the
   migration runner for now).
4. **Every direct dependency has a row in `docs/dependencies.md`** that says what it is for, why it was not
   written by hand, what happens if it is abandoned, and where it may be imported. A check enforces it.
5. **Versions are pinned exactly** (already enforced), installs run no scripts (already enforced), and
   Dependabot proposes updates. Docker and Compose changes never merge by themselves.
6. **The API has a published description**, generated from the route definitions (`@fastify/swagger`), so
   that readers who cannot import a TypeScript package, such as banks and auditors, can read the contract.
   A test keeps the generated file current.
7. **Each route declares who may call it**, and the application refuses to start if one does not. There is no
   development login. Until sign-in exists, every route that is not public answers 401.
8. **Errors have one format**: RFC 9457 problem details with a stable code, an English sentence for
   developers, and the request identifier. The front end translates by code. Values that a caller sent are
   never repeated in an answer or a log.

## Consequences

- Eleven direct dependencies and 69 installed packages, against two and a handful before. Each is a surface
  for vulnerabilities and a task for Dependabot. The register and the lock file are the controls.
- Fastify moves faster than Express between minor versions. Two options were already deprecated in the
  version installed, and the code uses their replacements. Pinning and review of each update absorb that.
- `fastify-type-provider-zod` is maintained by one person. If it is abandoned, the fallback is our own
  validator and serialiser functions for Fastify, about a hundred lines, and no route definition changes.
- The generated API description is a second thing to review in a pull request that changes a route. The test
  makes forgetting to regenerate it impossible.
- Fields that a response schema does not list are removed silently. That is the intended protection, and it
  also means a forgotten field in a schema shows up as a missing field in an answer, which tests will catch.
- The contracts package may use the test runner and assertions in its own tests, an exception to its purity
  rule.

## When to revisit

- If the register grows beyond about twenty direct dependencies, review it as a whole.
- When the portal skeleton is built: check that the same choices fit the internet-facing application, in
  particular the rate limit, the proxy settings and the limits on body size.
- The migration runner now uses `pg` (decided 2026-11-04, ADR 0006 and ADR 0005 decision 10).
- If `fastify-type-provider-zod` has no release for a year, or does not support the next major Fastify or zod,
  switch to the fallback.
