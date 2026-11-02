import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { PortServer } from '../background/PortServer'
import { handlePopupMessage } from '../background/popup'
import { buffered, PORT_NAME } from '../background/port'
import { makeRuntime } from '../background/runtime'

// The Effect runtime, the queue and the cache are in src/background (ARCHITECTURE.md §4). The
// `onConnect` and `onMessage` listeners must be registered when the worker starts, so everything
// they need is built lazily inside them.
export default defineBackground(() => {
  const runtime = makeRuntime(self.indexedDB)

  browser.runtime.onConnect.addListener(port => {
    if (port.name !== PORT_NAME) return
    // The runtime opens IndexedDB before it serves the port; keep what the tab sends meanwhile.
    const early = buffered(port)
    runtime
      .runPromise(PortServer.use(server => server.accept(early)))
      .catch(error => {
        console.error('audible-ex: the background failed to start', error)
        // Closing the port sends the content script down its reconnect path.
        port.disconnect()
      })
  })

  // The popup's cache size and clear requests (ARCHITECTURE.md §5).
  browser.runtime.onMessage.addListener((message, sender, respond) =>
    handlePopupMessage(
      effect => runtime.runPromise(effect),
      message,
      sender,
      respond
    )
  )
})
