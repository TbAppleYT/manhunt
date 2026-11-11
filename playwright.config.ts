import { defineConfig } from '@playwright/test';
// Runs against a production build: `npm run build` first. Uses the in-memory store (no DATABASE_URL).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3200', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  webServer: { command: 'npx next start -p 3200', url: 'http://localhost:3200/api/health', reuseExistingServer: false, timeout: 60_000, env: { DATABASE_URL: '' } },
});
