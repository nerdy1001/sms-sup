# 0002. Node.js and TypeScript, with the useful ideas of NestJS and without NestJS

Status: accepted

## Context

The architecture draft suggested NestJS and TypeScript. The developer knows Node.js well and cannot
afford the learning curve of NestJS now. The structure that NestJS provides (modules with explicit
boundaries, layers, injection of dependencies) is what the system needs, because several modules
will be built over months by one person who must be able to leave and return to any of them.

## Decision

Plain Node.js and strict TypeScript, no framework with decorators or an injection container. The
NestJS ideas that matter are kept, as conventions that the tooling enforces:

| Idea from NestJS | How it is done here |
|---|---|
| Modules with a public surface | A folder per module with an `index.ts` as its only public file |
| `imports: []` of a module | `dependsOn` in `module.json`, checked against the actual imports |
| Controllers, services, repositories | The `http`, `application` and `infrastructure` layers, with a `domain` layer for rules |
| Dependency injection | Each module exports `createXModule(dependencies)`; `module.ts` wires the layers; tests pass fakes. No container |
| Validation pipes | Input is validated by a schema in the `http` layer before it reaches a use case (FN-05) |
| Guards and interceptors | Hooks on routes for authorisation and audit (AC and FN-07) |
| Configuration module | One validated configuration object, read once at start-up in `kernel/config` (FN-05) |

The web framework is chosen in FN-05. Fastify is the likely choice (route schemas and encapsulated
plugins match the module idea); Express is acceptable. Nothing in this repository depends on it yet.

TypeScript runs without a build step in development and in tests (Node 22.18 or later removes the
types when it loads a file). The compiler is used to check types. Files therefore import each other
with the `.ts` extension, and the compiler option `erasableSyntaxOnly` rejects the few TypeScript
features that need a transformation (enumerations, namespaces, constructor parameter properties).

## Consequences

- The conventions replace what a framework would have imposed, so they are only as good as the
  checks. That is why the boundary checks come first (task FN-01).
- Fewer dependencies: this repository has two development dependencies (TypeScript and the Node
  types) and no production dependency yet. Every dependency is an attack surface and a maintenance
  cost, and the Ministry has no IT team to absorb either.
- If the project later grows a team that wants a framework, the module layout maps onto NestJS
  modules almost one to one.
