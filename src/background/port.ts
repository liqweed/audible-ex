/**
 * The part of `runtime.Port` the port server uses, so the server can be tested with a fake and the
 * browser's type stays out of its signatures, and `buffered`, which keeps a port's early messages.
 */

/** The `agx` port (ARCHITECTURE.md §5): one per tab, opened by the content script. */
export const PORT_NAME = 'agx'

export interface PortLike {
  readonly name: string
  postMessage(message: unknown): void
  readonly onMessage: {
    addListener(listener: (message: unknown) => void): void
  }
  readonly onDisconnect: { addListener(listener: () => void): void }
}

/**
 * Listens to `port` at once and hands what it heard to the listener added later. The worker builds
 * its Effect runtime (opening IndexedDB) after `onConnect` fires, and a message the content script
 * sends right after connecting would otherwise find no listener. Takes one `onMessage` and one
 * `onDisconnect` listener; a disconnect that already happened reaches the listener when it is added,
 * after the messages that came before it.
 */
export function buffered(port: PortLike): PortLike {
  const pending: unknown[] = []
  let onMessage: ((message: unknown) => void) | undefined
  let onDisconnect: (() => void) | undefined
  let disconnected = false

  port.onMessage.addListener(message => {
    if (onMessage) onMessage(message)
    else pending.push(message)
  })
  port.onDisconnect.addListener(() => {
    disconnected = true
    onDisconnect?.()
  })

  return {
    name: port.name,
    postMessage: message => port.postMessage(message),
    onMessage: {
      addListener(listener) {
        onMessage = listener
        for (const message of pending.splice(0)) listener(message)
      },
    },
    onDisconnect: {
      addListener(listener) {
        onDisconnect = listener
        if (disconnected) listener()
      },
    },
  }
}
