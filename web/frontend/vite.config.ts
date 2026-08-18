/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      allow: [".."],
    },
    // Playwright voice-benchmark runs write traces/screenshots into
    // benchmark-results/ inside this package; watching them made the dev
    // server reload every open page mid-benchmark (found during the
    // 2026-08-14 baseline run — it systematically killed 20-client rounds).
    watch: {
      ignored: ["**/benchmark-results/**"],
    },
  },
  test: {
    // geometry machines are pure, but JSXGraph adapters touch the DOM.
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // These master-branch POC checks are standalone `tsx` scripts, not Vitest suites.
    exclude: ["src/poc/geometry-actions/__tests__/**"],
  },
});
