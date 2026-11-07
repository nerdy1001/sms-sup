# 0008: Staff front end

Status: Accepted (2026-11-05)

## Context

The staff application needs a front end (task FN-06). It is used by staff members of the Ministry on
ordinary computers, it must work in English and French, and it shows personal data of students, so a
mistake in the browser can leak what the server protects. The team is one developer.

## Decisions

1. **Vite and React, built to static files.** A page that only calls the API does not need a server that
   renders pages. The build gives a folder of files and a small web server (Caddy) serves them. There is no
   Node process to patch or to attack in front of the API. Next.js was not taken because its main benefit
   (rendering on a server) is not needed here and it adds a server.
2. **One address for page and API.** In development Vite forwards `/api`, `/health` and `/ready` to the API;
   on staging Caddy does the same. The API has no CORS rule at all, and the `cors-open` rule stays in force.
3. **Nothing in browser storage, with one exception.** No token, no draft and no personal data is kept in
   `localStorage` or similar. The session will be an httpOnly cookie set by the API (task AC-01). The one
   exception (agreed 2026-11-05): the chosen language, the two letters "en" or "fr", under the key
   `sms.language`, in `src/i18n/language-preference.ts` and nowhere else. It is harmless if read or changed;
   a value that is not exactly "en" or "fr" is ignored; every call is guarded because storage can be missing
   or blocked. The exception is a suppression with a written reason (`web-ignore`), so it shows in every
   report. Any other use of storage is still an error. The choice belongs to one browser, which fits staff who work from one office computer (confirmed 2026-11-05); a server-side preference is not needed.
4. **i18next with react-i18next, texts kept in TypeScript.** (Changed 2026-11-05. The first version used a
   hand-written lookup; the decision was reversed at the owner's request, to use the standard library and keep
   plurals, number formats and more languages within reach.) English and French are two objects typed
   `Record<MessageKey, string>`, so a missing translation is still a compile error. Error messages are found
   by the stable error code of the API (`error.<code>`). Three settings keep the library inside the rules:
   no language detector plugin (it reads `localStorage` and cookies, which decision 3 forbids), key and
   namespace separators off (keys contain dots), and no escaping by the library (React escapes). The wrapper
   `useTranslation` accepts only a known key, so the library's loose string keys are not exposed to components.
   Each provider owns its own i18next instance.
5. **One API client.** `src/api/client.ts` makes every call, checks every answer against a schema from
   `packages/contracts`, and turns the RFC 9457 problem answer into an `ApiError`. A rule forbids network
   calls anywhere else.
6. **Components in the shadcn style.** Tailwind for styling, `class-variance-authority` for variants, Radix
   `Slot` for composition. The components are source files in `src/ui`, not a dependency to upgrade.
7. **Two test runners, by file name.** `*.test.ts` belongs to the Node test runner, `*.spec.ts(x)` to Vitest
   (it needs jsdom and the React plugin). `npm test` runs both.
8. **Strict content policy on staging.** Caddy sends `default-src 'none'` with only same-origin scripts,
   styles, images, fonts and connections, no framing and no inline script.

## Consequences

- i18next and react-i18next add about 15 to 20 KB (compressed) to the page and a small runtime lookup, in exchange for plurals and a standard format.
- Twenty new packages in the register (docs/dependencies.md). Vite 8 uses native binaries, so a build needs
  a platform that has them; the Docker build runs on Linux and installs them itself.
- Web code has its own repository rules (docs/boundaries.md, "Web applications").
- The front end image holds only static files and Caddy: one more container, no new runtime.

## When to revisit

- When the first screen needs a table with sorting and paging (consider a table library then).
- When translators need to edit texts without touching code (move the texts to JSON files that are loaded on demand), or when the bundle size of the catalogue matters.
- When AC-01 defines the session: check the cookie settings against decision 3.
