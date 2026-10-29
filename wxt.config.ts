import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'
import { apiHostPermissions } from './src/core/regions'

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  // WXT 0.21 resolves publicDir against the root, not srcDir; the icons live in src/public/icon.
  publicDir: 'src/public',
  // No auto-imports: every module imports what it uses, so the same code loads under `bun test`.
  imports: false,
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  // Version and description are package.json's (WXT copies them); the release step owns the version.
  manifest: {
    // Placeholder until the extension is named (issue #50).
    name: 'audible-ex',
    permissions: ['storage', 'unlimitedStorage'],
    // ARCHITECTURE.md §11; the content script's matches come from the same region table.
    host_permissions: ['https://www.goodreads.com/*', ...apiHostPermissions()],
  },
})
