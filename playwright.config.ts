import { defineConfig } from 'playwright/test'

// End-to-end smoke tests (`bun e2e`) against a built extension; kept apart from `bun test`.
export default defineConfig({
  testDir: 'e2e',
})
