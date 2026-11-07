# 6. Writing a route

This page shows how a module adds a route to the staff API, with a small example, and what the skeleton
does for you so that you do not have to. It assumes you have read [the modules page](03-modules.md).

## The shape of a route

A route says four things: where it lives, who may call it, what it accepts and what it returns. The
example is a made-up route that returns one country; it is not part of the system.

```ts
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

const countrySchema = z.object({ code: z.string(), name: z.string() });

export const countryRoutes = (): FastifyPluginAsyncZod => async (app) => {
  app.get(
    "/countries/:code",
    {
      config: { access: ["administrator", "attache"] },
      schema: {
        summary: "One country of study",
        tags: ["configuration"],
        params: z.object({ code: z.string().length(2) }),
        response: { 200: countrySchema },
      },
    },
    async (request) => {
      // request.params.code is a string: the schema checked it and gave the handler its type.
      // request.identity is the signed-in staff member (it is never null on a route that lists roles).
      return { code: request.params.code, name: "Example" };
    },
  );
};
```

The module exposes it as a `ModuleRoutes` function from its `index.ts`, and adds one line to
`apps/core-api/src/routes.ts`. The route is then served under `/api`, here as `GET /api/countries/FR`.

## Each part, and what happens if you leave it out

| Part | What it does | If you leave it out |
|---|---|---|
| `config: { access: ... }` | Says who may call the route: `"public"` or a list of roles. | The application refuses to start and names the route. |
| `config: { audit: ... }` | The action and the kind of object, for the audit log. Required on a route that changes data and is not public. | The application refuses to start and names the route. |
| `params`, `querystring`, `body` | Checked before your code runs. A failure is a 400 with the position and kind of each problem and never the value. The handler gets the typed result. | Nothing is checked. Add a schema anyway. |
| `response` | The answer is checked, and any field that is not in the schema is removed. List every success status the route can use (`200`, `201`, ...): a status without an entry is sent unchecked. | Nothing is removed from what you return, so a field can leak. Always write it. |
| `summary`, `tags` | Appear in `docs/api/openapi.json`. | The document has an operation with no description. |

Use `z.strictObject({...})` for a body when an unknown field should be refused, which is usually right.

## Routes that change data, and the audit log

The system must be able to answer "who did what, to which record, and when". Every route that changes data
(POST, PUT, PATCH, DELETE) and is not public declares an **audit action**, and does its work through
`request.transaction`. The kernel then writes the audit entry in the same transaction as your change.

```ts
app.patch(
  "/scholars/:id/suspend",
  {
    config: {
      access: ["attache"],
      audit: { action: "scholar.suspend", objectType: "scholar" },
    },
    schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ suspended: z.boolean() }) } },
  },
  (request) =>
    request.transaction(async (database, audit) => {
      await database.query("update registry.scholars set suspended = true where id = $1", [request.params.id]);
      audit.object(request.params.id, { reason_code: "missing_documents" });
      return { suspended: true };
    }),
);
```

- `audit.object(id)` says which record the request acted on. Call it once per record (ten records, ten calls).
  The `detail` (second argument) is for identifiers, counts and codes. **Never a name, phone number or
  amount**: a key that names personal data, or a value that looks like an e-mail address, stops the request.
- If the work fails, nothing is kept: no change and no entry. If the entry cannot be written, the change is
  not kept either.
- A **read of personal data** declares an action too (`scholar.read`) and uses `request.transaction` the same
  way. A read that shows no personal data (a list of countries) declares nothing and may use
  `database.asUser` directly.
- A person who is signed in but not allowed is recorded as `access.denied`, with the route as written and the
  roles that would have been allowed. Nothing for you to write.
- A route that declares an action and answers with success without having used `request.transaction` is a
  bug in the module. The answer is replaced by an error and the log says why, so tests show it at once.
- A public route cannot declare an action (nobody is signed in to be recorded), and cannot use
  `request.transaction`.

## What you do not write

- **Sign-in checks.** The access line is enough. A request without a signed-in staff member never reaches
  your handler (401), and neither does one with the wrong role (403).
- **Error answers.** To refuse, throw an `AppError` helper from `kernel/errors` (`notFound()`, `conflict("...")`,
  `forbidden()`). The skeleton turns it into the standard answer with its code. Do not build error answers by
  hand, and never put a name, number or any value from a record into the message: it is for developers and
  it reaches the log.
- **Logging a request.** One line per request is written for you, with the route as written and no values.
  If you log something yourself (`request.log.info({...}, "text")`), never put in personal data. A field named
  like personal data is replaced by `[redacted]`, but that is only a safety net.
- **Database identity.** To read or write data, use `request.transaction` (above), or for a read that needs no audit
  entry, `database.asUser(request.identity, async (db) => ...)`.
  Everything inside runs in one transaction in which the row-level security policies see the signed-in staff
  member. Pass values as parameters (`$1`, `$2`), never inside the text of the query.

New to Fastify? [7. Fastify, explained](07-fastify.md) explains the framework through this repository.

## After you add or change a route

1. Run `npm run api:docs`. It rewrites `docs/api/openapi.json`. Commit it with the route.
2. Test the route with `app.inject()`, as `kernel/http/server.test.ts` does: failures first (no sign-in, wrong
   role, bad input), then the success.
3. Run `npm run check`.

If you forget step 1, a test fails and says so.
