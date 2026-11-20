import { defineConfig, devices } from '@playwright/test'

const BASE = process.env.PW_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/fullstack/**', // full-stack specs run with playwright.fullstack.config.ts (needs the real backend)
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // PW_CHANNEL=msedge (or chrome) runs the specs in the installed browser when Playwright's own Chromium is not downloaded;
  // PW_BASE_URL points them at an already running dev server (default: one on port 5173, started here if needed)
  use: { baseURL: BASE, trace: 'retain-on-failure', ...devices['Desktop Chrome'], acceptDownloads: true, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: BASE, reuseExistingServer: true, timeout: 60_000 },
})
