# Kernel (student portal API)

Technical building blocks that every module may use: configuration, logging, errors, database access
helpers, the HTTP server, audit hooks and encryption. They arrive with tasks the same foundation tasks.

Rules:
- Modules may import the kernel. The kernel never imports a module.
- Network code lives in `kernel/http` (the server) and `kernel/net` (outbound clients).
- Configuration is read from the environment only in `kernel/config`.
- Database helpers live in `kernel/db`. The schema `platform` belongs to the kernel.
