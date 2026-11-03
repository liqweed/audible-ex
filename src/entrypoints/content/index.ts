import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { PORT_NAME } from '@/background/port'
import css from '@/content/badges.css?inline'
import { runWhileEnabled } from '@/content/lifecycle'
import { startContent } from '@/content/main'
import overviewCss from '@/content/overview.css?inline'
import { timeout } from '@/content/schedule'
import { contentScriptMatches } from '@/core/regions'
import { readPrefs, updateFilters, watchPrefs } from '@/storage/prefs'

// Badges and the hover overview on Audible cards (ARCHITECTURE.md §6). The panel is its own script (panel.content).
export default defineContentScript({
  matches: contentScriptMatches(),
  allFrames: false,
  main(ctx) {
    const lifecycle = runWhileEnabled({
      enabled: {
        read: async () => (await readPrefs()).enabled,
        watch: listener => watchPrefs(prefs => listener(prefs.enabled)),
      },
      start: () =>
        startContent({
          doc: document,
          location,
          connect: () => browser.runtime.connect({ name: PORT_NAME }),
          createIntersectionObserver: (callback, rootMargin) =>
            new IntersectionObserver(callback, { rootMargin }),
          schedule: timeout,
          filters: {
            read: async () => (await readPrefs()).filters,
            watch: listener => watchPrefs(prefs => listener(prefs.filters)),
            update: change => updateFilters(change),
          },
          css,
          overviewCss,
        }),
    })
    // After an extension reload this script is orphaned: stop observing and reconnecting.
    ctx.onInvalidated(() => lifecycle.stop())
  },
})
