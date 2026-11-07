import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The build tool and the test runner share this file. In development the page is served by Vite and the
 * calls to the API are sent on to the staff API (npm run dev, port 3000), so the browser sees one address
 * and no cross-origin request exists. Staging does the same job with Caddy (infra/staging/Caddyfile).
 * The API is never given a CORS rule: the front end and the API are always on the same address.
 */
const API = process.env["STAFF_API_URL"] ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": API, "/health": API, "/ready": API },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2023" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.{ts,tsx}"],
    setupFiles: ["./src/test-support/setup.ts"],
    css: false,
  },
});
