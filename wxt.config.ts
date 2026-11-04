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
  manifest: ({ browser }) => ({
    // The store name (issue #47): descriptive, and no Audible, Amazon or Goodreads trade dress.
    name: 'Book Ratings for Audible',
    permissions: ['storage', 'unlimitedStorage'],
    // ARCHITECTURE.md §11; the content script's matches come from the same region table.
    host_permissions: ['https://www.goodreads.com/*', ...apiHostPermissions()],
    // addons.mozilla.org (DECISIONS.md D29). Chrome would warn about the unknown key.
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // Permanent: AMO and every installed copy know the add-on by it.
          id: 'audible-ex@liqweed.github.io',
          // Firefox's own consent for data collection starts in 140.
          strict_min_version: '140.0',
          // Titles and authors read from the page go to Goodreads (PRIVACY.md).
          data_collection_permissions: { required: ['websiteContent'] },
        },
        // The same consent on Android starts in 142.
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  }),
})
