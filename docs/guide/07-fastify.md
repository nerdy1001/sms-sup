# 7. Fastify, explained through this repository

Fastify is the library that receives web requests for the staff application and turns them into calls to
our code. You do not need to know it before reading this page. It assumes only that you have seen a web
server written with Express or with plain `node:http`. Every example below is taken from this repository,
and the facts about order (what runs before what) were checked by running Fastify 5.12.7, the version
that is installed.

Read [6. Writing a route](06-writing-a-route.md) for the recipe, and this page for the reasons.

## 1. What Fastify does for us

Node can already listen on a port (`node:http`). What it hands you is raw: a request with its body still
arriving, and a response you must write byte by byte. A real server has to do many more things before any
of your code is useful:

| Job | Without a framework | In this repository |
|---|---|---|
| Decide which function answers `GET /health` | An `if` on the path and the method | Fastify's router. You write `app.get("/health", ..., handler)`. |
| Read the body and turn JSON into an object | Collect chunks, parse, handle bad JSON, size limits, `__proto__` tricks | Fastify does it. We only set the size limit (1 MiB). |
| Check that the input has the right shape | Your own code in every handler | A zod schema on the route, checked by Fastify before the handler runs. |
| Turn the return value into JSON | `JSON.stringify` and headers | Fastify, checked against a response schema that also removes unlisted fields. |
| Run shared steps (sign-in check, headers, logs) | Call them by hand in every handler | Hooks: functions registered once that Fastify calls at fixed moments. |
| Handle errors in one place | `try`/`catch` everywhere | One error handler (`kernel/http/failure.ts`). |
| Test without opening a port | Start a real server | `app.inject()`, which runs a request through everything in memory. |

The rest of this page explains the vocabulary, the order in which things happen, and how `createApp`
(`apps/core-api/src/kernel/http/server.ts`) uses each part.

## 2. The vocabulary

| Word | Meaning | Where you see it here |
|---|---|---|
| **Instance** | The application object returned by `fastify(...)`. Everything is attached to it. We call it `app`. | `createApp` builds one; `main.ts` makes it listen through `startApplication`. |
| **Route** | A method, a path, some options and a handler. | `app.get("/health", { ... }, handler)` in `kernel/http/health.ts`. |
| **Handler** | The function that answers a route. It receives `request` and `reply`. | The last argument of `app.get(...)`. |
| **Request** | What the caller sent: `request.body`, `request.params`, `request.query`, `request.headers`, and in our case `request.identity`. | Typed by the route's schema. |
| **Reply** | What you send back: `reply.status(201).send(...)`, `reply.header(...)`. | Used when the status is not 200. |
| **Hook** | A function that Fastify calls at a fixed moment of every request (or at a fixed moment of the application's life). | `onRequest`, `onResponse` and `onRoute` in `server.ts`. |
| **Plugin** | A function `async (app) => { ... }` that adds routes, hooks and so on. Registered with `app.register`. | `healthRoutes`, and every module's routes. |
| **Encapsulation** | What a plugin adds is visible only inside it and in plugins registered inside it. Siblings do not see each other. | Section 5. |
| **Decorator** | A property that you add to the instance, the request or the reply. | `app.decorateRequest("identity", null)`. |
| **Schema** | A description of the shape of a part of the request or the response. | The `schema:` option of a route, written with zod. |
| **Type provider** | The piece that lets TypeScript infer the types of `request.body` and so on from the schema. | `fastify-type-provider-zod`. |
| **Serializer** | The piece that turns the returned value into the text sent on the wire. | Also from `fastify-type-provider-zod`: it checks the answer against the response schema. |
| **Lifecycle** | The fixed sequence of steps one request goes through. | Section 3. |

## 3. The life of one request

This is the most useful thing to know. Fastify moves every request through the same steps in the same
order. Hooks attach to the steps. The order below was checked by running a request through a Fastify
instance that logs each step.

| Step | What happens | What this repository does here |
|---|---|---|
| 1. Routing | Fastify finds the route for the method and path. If none matches, the not-found handler runs. | `setNotFoundHandler` answers 404, or 405 with an `Allow` list when the path exists for another method. |
| 2. `onRequest` | The first hook. The body has not been read yet. | Adds `x-request-id` and `cache-control: no-store`. Then, if the route is not public, asks who is calling and answers 401 or 403. |
| 3. `preParsing` | Before the body is turned into an object. | Not used. |
| 4. Parsing | The body is read (size limit, content type) and turned into an object. | Only `application/json` is accepted; `text/plain` was removed on purpose. |
| 5. `preValidation` | Before the checks. | Not used. |
| 6. Validation | `params`, `querystring`, `headers` and `body` are checked against the route's schema. A failure jumps to the error handler. | zod, through `validatorCompiler`. |
| 7. `preHandler` | Last chance before your code. | Not used yet. |
| 8. Handler | Your function runs. | The route's code. |
| 9. `preSerialization` | The value you returned, before it becomes text. | Not used. |
| 10. Serialization | The value is checked against the response schema and turned into text. Unlisted fields are removed. | zod, through `serializerCompiler`. |
| 11. `onSend` | The text is ready, the headers can still change. | Not used. |
| 12. `onResponse` | The answer has been sent. | Writes the one log line for the request. |

When something throws at any step from 2 to 10, Fastify skips the steps that remain, runs the **error
handler**, and then still runs `onSend` and `onResponse`. The experiments, shown as the order in which the
steps ran:

```
Normal request:   onRequest, preParsing, preValidation, preHandler, handler, preSerialization, onSend, onResponse
Handler throws:   onRequest, preValidation, preHandler, handler, errorHandler, onSend, onResponse
onRequest throws: onRequest, errorHandler, onSend, onResponse
```

Two consequences matter for this repository:

- **The sign-in check is in `onRequest`, so it happens before the body is read or validated.** A stranger
  who is not signed in gets 401 whatever the body says, and learns nothing about the shape of the input.
  There is a test for exactly this.
- **The log line is written in `onResponse`, which runs even for errors.** That is why 401, 404 and 500
  answers all leave a line.

## 4. `createApp`, piece by piece

`createApp` in `kernel/http/server.ts` builds the instance. Reading it from the top:

1. **`fastify({ ... })`** creates the instance with its settings: our logger (`loggerInstance`), the request
   identifier generator (`genReqId`), whether to trust the proxy's client address (`trustProxy`), the body
   limit (`bodyLimit`, 1 MiB) and the request timeout (30 seconds). The `LogController` setting switches off
   Fastify's own request lines, because they contain the full address with the query string, and we write our
   own line without it.
2. **`removeContentTypeParser("text/plain")`** leaves JSON as the only body format, for the reason explained
   in [FN-05](../tasks/FN-05.md) (cross-site request forgery).
3. **`setValidatorCompiler` and `setSerializerCompiler`** tell Fastify to use zod for input checks and
   output checks. Without these two lines Fastify would expect JSON Schema, its native format.
4. **The `onRoute` hook** runs once for every route at the moment the route is registered, not once per
   request. Ours refuses any route without a valid `config.access`, which makes the application fail to
   start. It is added **before** any route is registered, because `onRoute` only sees routes that come
   after it. (The other hooks do not have this limit: a request-time hook added in a parent reaches the routes
   of every plugin below it, even one registered earlier.)
5. **`register(swagger)`, `register(helmet)`, `register(rateLimit)`** add three ready-made plugins:
   the OpenAPI collector, the security headers, and the rate limit. Swagger must come before the routes so
   that it sees them. Each `register` is awaited, so the plugin is fully loaded before the next line runs.
6. **`decorateRequest("identity", null)`** reserves a place on every request for the signed-in staff member.
   Declaring it up front lets Fastify create requests with the same shape every time, which it is faster at,
   and `access.ts` tells TypeScript the property exists.
7. **The `onRequest` hook** (request identifier, no-store header, sign-in check), **the `onResponse` hook**
   (the log line), **`setErrorHandler`** (every thrown value becomes a problem details answer) and
   **`setNotFoundHandler`** (404 and 405).
8. **`register(healthRoutes(...))`** and the module routes, each under the prefix `/api`.
9. The instance is returned. Nothing listens yet. `startApplication` calls `app.listen`, and tests call
   `app.inject`.

## 5. Plugins and encapsulation

A Fastify application is a tree of plugins. `app.register(plugin, options)` runs the plugin with a **child**
of the current instance. The child sees everything the parent had, and anything the child adds (a hook, a
decorator, a route) stays inside the child and the plugins registered inside it. This was tested:

```
a hook added inside plugin A reaches A's own routes:      yes
the same hook reaches the routes of sibling plugin B:     no
```

Why it matters here: **each module's routes are a plugin**, so a module that adds a hook (for example an
audit hook for its own routes) cannot change the behaviour of another module. This is the Fastify version of
the rule that modules do not reach into each other.

The things registered on the root instance in `createApp` (the hooks, the error handler, the headers, the rate
limit) apply to every plugin below, which is why modules never repeat them.

`prefix` is an option of `register`. `app.register(plugin, { prefix: "/api" })` makes the route `/countries` in
the plugin answer at `/api/countries`. The health routes are registered without a prefix, so they stay at
`/health` and `/ready`.

A plugin can be written two ways: with a callback or `async`. This repository always uses `async`:

```ts
export const healthRoutes = (options: HealthOptions): FastifyPluginAsyncZod => async (app) => {
  app.get("/health", { ... }, () => ({ status: "ok", ... }));
};
```

The outer function is a small factory that takes our own dependencies (the database, the version) and
returns the plugin. This is how a module gets what it needs without a global variable, and how tests pass
fakes.

We do not use `fastify-plugin`, the helper that switches encapsulation off. If you ever need one plugin's
decorator to be visible to its siblings, that is the tool, and it should be a conscious, reviewed decision.

## 6. Schemas: validation in, serialization out

A route can carry a `schema` with five optional parts: `params` (the `:id` in the path), `querystring` (the
part after `?`), `headers`, `body`, and `response`. In this repository each is a **zod schema**.

```ts
app.post(
  "/things",
  {
    config: { access: ["administrator"] },
    schema: {
      body: z.strictObject({ name: z.string().min(2), count: z.number().int() }),
      response: { 201: z.object({ id: z.string() }) },
    },
  },
  async (request, reply) => reply.status(201).send({ id: request.body.name }),
);
```

What happens, in order:

1. **Validation.** Before the handler runs, Fastify asks zod to check `request.body`. If it fails, the handler
   never runs and the error handler answers 400. Our error handler (`failure.ts`) reads the list of problems
   and sends only the position (`body.count`) and the kind (`invalid_type`), never the value.
2. **Types.** Because of the type provider, `request.body.name` is a `string` in your editor. You wrote the
   shape once and got the check and the type.
3. **Coercion.** `z.coerce.number()` turns the text `"10"` of a query string into the number 10 before the
   handler sees it. Without `coerce`, query values stay text.
4. **Serialization.** After the handler returns, Fastify asks zod to check the returned value against the
   response schema for that status code. Two things follow:
   - **Fields that the schema does not list are removed.** If a handler returns `{ id, nationalId }` and the
     schema lists only `id`, the caller receives only `id`. This is a deliberate protection against leaking a
     field by accident.
   - **A value that does not fit the schema is a bug.** The caller gets 500, the log gets the details, and
     the wrong data is never sent.
5. **Only listed status codes are checked.** A response schema `{ 200: ... }` checks answers with status 200.
   An answer with another status (such as the problem details of an error) is sent as it is. That is why
   error answers are not blocked by the response schema. **It is also a trap:** a handler that replies with
   status 201 or 202 and has no schema for that status sends everything it was given, including fields that
   should not leave. This was tested. List every success status that a route can return, as in the example
   above (`201: ...`).

`z.strictObject` rejects unknown fields; plain `z.object` silently ignores them. For a body, strict is
usually what you want.

## 7. The handler

A handler can be written in three ways, and they all work in Fastify. This repository uses all three.

```ts
// 1. Return the value. Fastify sends it with status 200.
async () => ({ status: "ok" })

// 2. Use reply when you need another status or header. Return the result of send.
async (request, reply) => reply.status(201).send({ id: "..." })

// 3. An ordinary function (not async) that returns the value. The health route is written this way.
() => ({ status: "ok" })
```

Rules that prevent the usual mistakes:

- **An async handler must either return the value or return `reply.send(...)`.** Calling `reply.send` and then
  returning something else sends the answer twice.
- **Throw to fail.** `throw notFound()` anywhere in the handler, or in code it calls, reaches the error handler.
  There is no need for a `try`/`catch` unless you want to translate an error (for example a database error
  into a `conflict`).
- **Async hooks take no `done` argument.** Fastify refuses at start-up (`FST_ERR_HOOK_INVALID_ASYNC_HANDLER`) a
  hook that is `async` and also declares a `done` callback. The `onResponse` hook in `server.ts` is the
  callback style on purpose, so it calls `done()`.

## 8. Hooks that this repository uses

| Hook | Where | What it does |
|---|---|---|
| `onRoute` | `server.ts` | At registration time: refuses a route without a valid `access`. |
| `onRequest` | `server.ts` | Per request: identifier, no-store, then the sign-in check for routes that are not public. |
| `onResponse` | `server.ts` | Per request: the log line (method, route as written, status, duration). |
| error handler | `server.ts`, `failure.ts` | Per failure: turns any thrown value into the problem details answer, and logs bugs. |
| not-found handler | `server.ts` | For a path that no route matches: 404 or 405. |

The route's own `config` object carries our settings. `config: { access: ... }` is read in `onRequest`
through `request.routeOptions.config.access`. `config: { quiet: true }` lowers the log level of the health
checks, and `config: { rateLimit: false }` is a setting that the rate-limit plugin reads from the same place.
One object, several readers: that is the intended use of `config`.

## 9. Errors

Anything that is thrown, rejected or passed to `reply.send(error)` ends in the error handler. Our handler asks
`classify` (in `failure.ts`) what it is:

| What was thrown | Becomes |
|---|---|
| An `AppError` (`notFound()`, `conflict("...")`) | Its own code and status, with its sentence. |
| A validation failure from zod | 400 `validation_failed`, with `errors: [{ path, code }]`. |
| A response that does not fit its schema | 500 `internal_error`, logged as a bug. |
| A framework error with a known status (unreadable JSON, body too large, wrong content type, rate limit) | 400, 413, 415 or 429, with its own code. |
| Anything else | 500 `internal_error`, no detail, logged as a bug. |

Fastify errors carry a `code` that starts with `FST_` (for example `FST_ERR_CTP_BODY_TOO_LARGE`) and a
`statusCode`. They are listed in `node_modules/fastify/docs/Reference/Errors.md`.

## 10. Logging

Fastify creates a **child logger** for each request and puts it on `request.log`. Every line written through
it carries the request identifier (we named the field `requestId`). Use `request.log.info({ ... }, "text")`
inside a handler. The first argument is an object of fields, the second is the message. Never put personal
data in either; the redaction list is only a safety net.

In `createApp`, `loggerInstance: logger` hands Fastify the logger built in `kernel/logging/logger.ts`, so
everything Fastify writes goes through the same redaction and the same format.

## 11. Testing with `inject`

`app.inject({ method, url, headers, payload })` runs a request through the whole lifecycle, including hooks,
validation and serialization, without opening a port. It returns an object with `statusCode`, `headers`,
`body` (text) and `json()`. This is how `kernel/http/server.test.ts` works.

```ts
const response = await app.inject({ method: "GET", url: "/health" });
assert.equal(response.statusCode, 200);
assert.deepEqual(response.json(), { status: "ok", service: "core-api", version: "abc123" });
```

It is fast (no network) and exact (the same code path as a real request, except the network). Tests that need
a real port, such as `start.test.ts`, start the application on port 0, which asks the system for a free port.

Always close the instance at the end of a test (`await app.close()`), or the test runner waits for it.

## 12. Starting and stopping

- `await app.ready()` loads every plugin and runs every `onRoute` hook. If a route has no `access`, it fails
  here. `app.listen` calls it for you.
- `await app.listen({ host, port })` opens the port.
- `await app.close()` stops accepting new connections and waits for the requests in progress. `startApplication`
  calls it first, then closes the database pool, so no request loses its database halfway.
- `main.ts` calls the stop when it receives SIGTERM (what a container platform sends) or Ctrl+C.

## 13. Mistakes to expect, and what they look like

| Symptom | Likely cause |
|---|---|
| The application does not start and says a route "does not say who may call it" | The route has no `config: { access: ... }`. |
| `FST_ERR_HOOK_INVALID_ASYNC_HANDLER` at start | An `async` hook that also takes a `done` argument. Remove one of the two. |
| A field is missing from an answer | It is not in the response schema. Add it there. |
| 500 `internal_error` on a route that returns something | The returned value does not match the response schema. The log line has `FST_ERR_RESPONSE_SERIALIZATION`. |
| A query value arrives as text | Use `z.coerce.number()` (or another coerce) for it. |
| A change in one module changes another | A hook or decorator was added on the root instance, not inside the module's plugin. |
| An extra field is sent although the schema does not list it | The route replied with a status that has no entry in `response` (for example 201 with only `200` listed). Add the status. |
| A route you added does not appear in `docs/api/openapi.json` | Run `npm run api:docs`. |
| Answer sent twice, or a warning about it | The handler called `reply.send` and also returned a value. |
| A test never finishes | The instance was not closed with `await app.close()`. |
| 404 for a path with the wrong method on a path with a parameter | Known limit: only fixed paths get 405 (see FN-05). |

## 14. Where to read more

The documentation of the installed version is on your computer, in `node_modules/fastify/docs/`. The most
useful files:

| File | Read it to learn |
|---|---|
| `Reference/Lifecycle.md` | The order of the steps, with a diagram. |
| `Reference/Hooks.md` | Every hook, its arguments and when it runs. |
| `Reference/Routes.md` | The options of a route. |
| `Reference/Plugins.md` and `Reference/Encapsulation.md` | How plugins and scope work. |
| `Reference/Validation-and-Serialization.md` | How schemas work in Fastify itself (the part we replaced with zod). |
| `Reference/Reply.md` and `Reference/Request.md` | Everything on `reply` and `request`. |
| `Reference/Errors.md` | The list of `FST_` error codes. |
| `Reference/Logging.md` | How the request logger works. |

The same pages are on the Fastify website, `fastify.dev`. The documentation of the zod connection is in the
README of `fastify-type-provider-zod` (in `node_modules/fastify-type-provider-zod/`). Fastify's own
documentation describes JSON Schema in most examples; where it does, remember that here the schema is a zod
object and the two compilers set up in `createApp` do the translation.

## 15. If you know Express

| Express | Fastify here |
|---|---|
| `app.use(middleware)` | A hook (`onRequest` and so on), or a plugin. There is no `next()`; an async hook simply returns, or throws to stop. |
| `req.body`, `req.params` | The same names on `request`, typed by the schema. |
| `res.status(201).json(x)` | `reply.status(201).send(x)`, or just `return x` for status 200. |
| An error-handling middleware with four arguments | `setErrorHandler`, one per scope. |
| `express.Router()` | A plugin registered with a `prefix`. |
| Validation with a separate library in each route | The `schema` option, checked by the framework before the handler. |
| `supertest` to test | `app.inject()`, with no port. |
