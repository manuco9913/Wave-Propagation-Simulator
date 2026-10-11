import { defineConfig } from "@playwright/test";

// End-to-end: a real browser on the real app, the Vite dev server proxying to the real backend
// (throwaway Postgres database, fixture terrain, fake engine). Needs TEST_DATABASE_URL.
const BACKEND_PORT = 8765;
const FRONTEND_PORT = 5174;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts", // not *.test.ts / *.spec.ts, which vitest would collect
  timeout: 90_000,
  fullyParallel: false,
  workers: 1, // one backend, one worker: runs share the queue
  reporter: "list",
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    viewport: { width: 1400, height: 900 },
    launchOptions: {
      // Software WebGL, so the map and heatmap render on machines without a GPU (CI).
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: [
    {
      command: `uv run --project ../backend python ../backend/scripts/e2e_server.py --port ${BACKEND_PORT}`,
      url: `http://localhost:${BACKEND_PORT}/api/schema/entity`,
      timeout: 60_000,
      reuseExistingServer: false,
      // SIGTERM (not the default SIGKILL) lets it drop its throwaway database.
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      command: `pnpm exec vite --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${BACKEND_PORT}` },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
