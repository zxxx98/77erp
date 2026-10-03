import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3199",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && node tests/browser/server.js",
    url: "http://127.0.0.1:3199/api/data",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
