import { defineConfig } from 'playwright/test'
import { VIEWPORT } from './scenes'

const PORT = 4175

// Visual regression tests of the UI gallery (`bun run visual`; DECISIONS.md D27). Baselines are per
// platform, because fonts render differently on each; they are made and compared on the machine that
// runs them, not in CI. `bun run visual:update` saves new ones after a deliberate change.
export default defineConfig({
  testDir: '.',
  testMatch: 'visual.spec.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  outputDir: '../../.output/visual',
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../.output/visual-report', open: 'never' }],
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    // The full Chromium bun e2e already uses, in its new headless mode: no second browser to install.
    channel: 'chromium',
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-GB',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixels: 10,
    },
  },
  // A server of its own on another port, started fresh, so an open `bun run gallery` neither
  // conflicts with it nor serves it stale code.
  webServer: {
    command: `GALLERY_PORT=${PORT} bunx vite --config test/gallery/vite.config.ts`,
    cwd: '../..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
})
