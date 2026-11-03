import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5178'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5178 --strictPort',
    url: baseURL,
  },
})
