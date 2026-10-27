# core-api

The staff application: the internal system of the Ministry. It runs only on the Ministry network
(zone rules in docs/architecture and docs/boundaries.md). It calls out to the student portal and to
the mail relay; nothing calls in from the internet.

The application skeleton (configuration, logging, errors, API contract) is task FN-05. Until then,
`src/main.ts` starts a placeholder service with only `GET /health`, so that staging has something to
deploy (task FN-03). It reads `PORT` and `APP_VERSION` from the environment and is replaced by FN-05. The database it will use is described in `src/kernel/README.md`.
