# Kernel (staff application)

Technical building blocks that every module may use. Task FN-05 built the skeleton; FN-07 added the audit hooks, and
encryption arrives with FN-09. `docs/tasks/FN-05.md` explains each choice.

| Folder | What it holds |
|---|---|
| `config/` | `loadConfig` reads and checks the settings once at start (and lists every problem without printing a value). `Secret` hides a password from logs and dumps. The only place, with `main.ts`, that may read `process.env`. |
| `logging/` | The logger (JSON lines, with the redaction of sensitive fields) and `errorFields`, which decides what the log may say about an error. |
| `errors/` | `AppError` with its stable codes, and the conversion of any thrown value into the problem details answer. |
| `http/` | The web server (`server.ts`), the rule that every route declares who may call it, the sign-in hook, the classification of failures, the audit hooks (`audit-hooks.ts`: the audit rule for routes, `request.transaction`, the record of refusals), the health routes and the API description. The only place, with `main.ts`, where network code may live. |
| `audit/` | What an audit entry may hold (identifiers and codes, never personal data), how entries are written, and the trail a handler uses to say which records a request touched. Pure code: no web server. |
| `db/` | The connection pool (`database.ts`), `context.ts` (`runAs`: run a request's queries in a transaction in which the policies see the staff member), and the migrations and seeds of the `platform` schema. |
| `seed/` | The generator of synthetic data: scholars, attaches, schools, years, documents, phone numbers and payments, with labelled awkward cases (repeatable; `npm run seed:data`). |

How a request moves through these is in the "How it works" part of `docs/tasks/FN-05.md`. To add a route,
read `docs/guide/06-writing-a-route.md`. New to Fastify? Read `docs/guide/07-fastify.md` first.

Rules:
- Modules may import the kernel. The kernel never imports a module.
- Network code lives in `kernel/http` (the server) and `kernel/net` (outbound clients).
- Configuration is read from the environment only in `kernel/config` and `main.ts`.
- Database code lives in `kernel/db`. The schema `platform` belongs to the kernel.
- No code logs a request body, a header, a query string or any personal data.
