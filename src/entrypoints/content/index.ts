import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { PORT_NAME } from '@/background/port'
import css from '@/content/badges.css?inline'
import { startContent } from '@/content/main'
import { timeout } from '@/content/schedule'
import { contentScriptMatches } from '@/core/regions'

// Badges on Audible cards (ARCHITECTURE.md §6). The panel and the filters arrive in later phases.
export default defineContentScript({
  matches: contentScriptMatches(),
  allFrames: false,
  main(ctx) {
    const content = startContent({
      doc: document,
      location,
      connect: () => browser.runtime.connect({ name: PORT_NAME }),
      createIntersectionObserver: (callback, rootMargin) =>
        new IntersectionObserver(callback, { rootMargin }),
      schedule: timeout,
      css,
    })
    // After an extension reload this script is orphaned: stop observing and reconnecting.
    ctx.onInvalidated(() => content?.stop())
  },
})
