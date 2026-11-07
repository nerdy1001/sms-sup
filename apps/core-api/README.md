# core-api

The staff application: the internal system of the Ministry. It runs only on the Ministry network
(zone rules in docs/architecture and docs/boundaries.md). It calls out to the student portal and to
the mail relay; nothing calls in from the internet.

The skeleton (task FN-05) is in place: configuration, logging, errors, the web server and the API
description. Read `docs/tasks/FN-05.md` for what it does and why, and `src/kernel/README.md` for where
things live. The routes of the modules are listed in `src/routes.ts`.

Running it on your computer:

```
npm run db:up        # the database, once per session (needs Docker)
npm run db:migrate   # and the first time, or after pulling new migrations
npm run dev          # the API on http://127.0.0.1:3000, restarting when a file changes
```

Then open http://127.0.0.1:3000/health (is it running?) and http://127.0.0.1:3000/ready (can it reach the database?).
