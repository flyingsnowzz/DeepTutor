import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/acceptance',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:3784',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'DEEPTUTOR_API_ORIGIN=http://127.0.0.1:8011 npx vite --host 127.0.0.1 --port 3784',
    url: 'http://127.0.0.1:3784',
    reuseExistingServer: false,
  },
})
