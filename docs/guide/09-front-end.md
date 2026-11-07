# 9. The staff front end

This page explains `apps/staff-web` from zero. Read guide 1 first.

## What it is

A web page that runs in the browser of a staff member. It has no database and no secret. Everything it knows,
it asks the API. Think of it as a remote control: the buttons are in the browser, the television is the API.

## The tools, in one line each

| Tool | What it does here |
|---|---|
| React | Builds the screen out of small functions called components. |
| Vite | Turns the source files into the folder of files a browser can load (`npm run build`), and runs a development server. |
| react-router | Shows a different component for each address (`/`, `/sign-in`, anything else). |
| Tailwind | Styling by short class names written in the markup. |
| i18next | Looks up each text by its key in the chosen language, fills in values and handles plural forms. `react-i18next` connects it to React. |
| Vitest | Runs the front end tests in a pretend browser (jsdom). |

## A tour of `apps/staff-web/src`

| Folder or file | What it is for |
|---|---|
| `main.tsx` | The start: puts the app on the page. |
| `app.tsx` | The routes: which address shows which page. |
| `layout/shell.tsx` | The frame around every page: header, language switch, navigation. |
| `pages/` | One file per screen. Today: home, sign-in (a placeholder until AC-01) and not-found. |
| `api/client.ts` | The only place that talks to the API. Checks every answer against a schema from `packages/contracts`. |
| `i18n/` | `messages.ts` holds the English and French texts; `i18n.tsx` sets up i18next and gives components a `useTranslation` hook that accepts only known keys. |
| `i18n/language-preference.ts` | Remembers the chosen language ("en" or "fr") in the browser. The only file allowed to use browser storage. |
| `error-message.tsx` | Turns an API error into a sentence in the chosen language, using the error code. |
| `ui/` | Small reusable pieces: button, field, alert. |
| `test-support/` | Helpers for tests only. |

## What happens when the home page loads

1. The browser asks for `/`. Caddy (staging) or Vite (development) answers with `index.html`.
2. The page loads the script. React draws the shell and the home page.
3. The home page calls the API through the client. The call goes to the same address as the page, so the
   browser sees no second site.
4. The answer is checked against the schema. A good answer shows the status; a failure shows a message
   chosen by the error code in the current language.

## Why the strange rules

A page can be read and altered by anyone who uses it, so the rules are about limiting damage: no browser
storage (nothing to steal from it), no raw HTML (the usual way to inject a script), one place for network
calls (so they can be reviewed in one file), no outside addresses. The list with reasons is in
docs/boundaries.md.

## Commands

    npm run dev --workspace @minesup/staff-web     # page on http://127.0.0.1:5173
    npm run test --workspace @minesup/staff-web    # the front end tests
    npm run build --workspace @minesup/staff-web   # the static files in apps/staff-web/dist

`npm run dev` at the root starts the API; run both to see the page talk to it. `npm run check` covers the
types, rules and tests of the front end as well.

The decisions are in docs/adr/0008-staff-front-end.md.
