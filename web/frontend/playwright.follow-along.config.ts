import { defineConfig, devices } from "@playwright/test";

/** C3 UI/transport harness only. No backend, registry, approval or model dependency. */
const port = Number(process.env.FOLLOW_ALONG_UI_PORT ?? 5197);
export default defineConfig({
  testDir: "./e2e/follow-along/specs",
  outputDir: process.env.FOLLOW_ALONG_UI_OUTPUT ?? "/private/tmp/c3-follow-along-browser-results",
  workers: 1, retries: 0, timeout: 30_000,
  reporter: [["line"]],
  use: { baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 60_000,
    env: { VITE_API_BASE_URL: `http://127.0.0.1:${port}` },
  },
  projects: [{ name: "follow-along-chromium", use: { ...devices["Desktop Chrome"] } }],
});
