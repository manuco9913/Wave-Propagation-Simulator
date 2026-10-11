/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  // API_PROXY_TARGET lets the end-to-end tests point the dev server at their own backend.
  server: { proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:8000" } },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
