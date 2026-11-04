// The UI gallery's dev server (`bun run gallery`, and the web server of `bun run visual`): the same
// Tailwind plugin and `@/` alias as the extension build (wxt.config.ts), without WXT.
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const SRC = fileURLToPath(new URL('../../src', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    tailwindcss(),
    // Vite watches its root, this folder; the extension's code is outside it.
    {
      name: 'watch-src',
      configureServer(server) {
        server.watcher.add(SRC)
      },
    },
  ],
  resolve: {
    alias: { '@': SRC },
  },
  server: { port: Number(process.env.GALLERY_PORT ?? 4174), strictPort: true },
})
