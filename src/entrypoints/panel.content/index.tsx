import { createRoot } from 'react-dom/client'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import { defineContentScript } from 'wxt/utils/define-content-script'
import logoSvg from '@/assets/brand/logo-small.svg?raw'
import { PANEL_HOST } from '@/content/cards'
import { watchHandle } from '@/content/shared'
import { contentScriptMatches } from '@/core/regions'
import { runPanel } from '@/panel/host'
import { Panel } from '@/panel/Panel'
import panelCss from '@/panel/panel.css?inline'

// The logo as an image URL: bundled as text, so no web-accessible resource is needed either.
const LOGO = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`

// The floating panel (ARCHITECTURE.md §6, DECISIONS.md D19): a second content script, so React stays
// out of content.js. It takes the badge script's state from the shared handle and draws in a shadow
// root. Its stylesheet is bundled as text and handed to WXT, so no web-accessible resource is needed.
export default defineContentScript({
  matches: contentScriptMatches(),
  allFrames: false,
  main(ctx) {
    const stop = runPanel({
      watch: listener => watchHandle(document, listener),
      mount: async handle => {
        const ui = await createShadowRootUi(ctx, {
          name: PANEL_HOST,
          position: 'inline',
          anchor: 'body',
          css: panelCss,
          onMount: container => {
            const root = createRoot(container)
            root.render(<Panel handle={handle} logoSrc={LOGO} />)
            return root
          },
          onRemove: root => root?.unmount(),
        })
        ui.mount()
        return ui
      },
      onError: error =>
        console.error('audible-ex: could not show the panel', error),
    })
    ctx.onInvalidated(stop)
  },
})
