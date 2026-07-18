import { defineConfig, devices } from "@playwright/test";

// Use 3010 so local `next dev` on 3000 is not confused with the e2e server.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3010);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Force mock mode for e2e even when a live BACKBOARD_API_KEY is present in
    // the developer .env, so CI and local Playwright never spend API credits.
    command: `npm run build && npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      ...process.env,
      BACKBOARD_MOCK_MODE: "true",
      PORT: String(PORT),
    },
  },
});
