import { defineConfig } from '@playwright/test'

/** UI smoke tests: the renderer in a browser against the fake engine (`?demo`). They need `npx playwright install chromium` once. */
export default defineConfig({
  testDir: 'tests/ui',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '.claude/temp/playwright-results',
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1600, height: 960 },
    trace: 'off'
  },
  webServer: {
    command: 'npx vite --config vite.ui.config.ts',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000
  }
})
