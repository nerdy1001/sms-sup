# Kernel (staff application)

Technical building blocks that every module may use: configuration, logging, errors, database access
helpers, the HTTP server, audit hooks and encryption. They arrive with tasks FN-04 to FN-09.
For now `http/health.ts` holds the placeholder health service (FN-03), which FN-05 replaces.

Already in place (FN-04):
- `db/migrations` and `db/seeds`: the SQL of the `platform` schema (staff users, audit log, the functions that
  read the identity) and its synthetic seed data. Applied by `npm run db:migrate` and `npm run db:seed`.
- `db/context.ts`: `runAs` runs a request's queries in a transaction in which the row-level security
  policies see the signed-in staff member. Every request that touches data goes through it.
- `seed/synthetic-scholars.ts`: invented scholars for development (200 by default, repeatable).

Rules:
- Modules may import the kernel. The kernel never imports a module.
- Network code lives in `kernel/http` (the server) and `kernel/net` (outbound clients).
- Configuration is read from the environment only in `kernel/config`.
- Database helpers live in `kernel/db`. The schema `platform` belongs to the kernel.
