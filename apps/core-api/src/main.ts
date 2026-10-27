import { createHealthServer } from "./kernel/http/health.ts";

const port = Number(process.env.PORT ?? "3000");
const version = process.env.APP_VERSION ?? "unknown";

const server = createHealthServer({ version });
server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`${JSON.stringify({ event: "listening", port, version })}\n`);
});

// Stop cleanly when the container is stopped, so that a deployment never cuts a request in half.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
