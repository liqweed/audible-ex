/**
 * Runs the content script only while the extension is switched on. The switch is the `enabled` pref
 * (popup), so it applies to every open Audible tab at once: turning it off takes the badges off the
 * page and closes the port, which ends this tab's lookups; turning it on starts the script again,
 * and books still in the cache are drawn from it without a request to Goodreads.
 */
import type { Content } from './main'

export interface Enabled {
  /** The switch as it is now. */
  read(): Promise<boolean>
  /** Calls `listener` on each change; returns the function that stops listening. */
  watch(listener: (enabled: boolean) => void): () => void
}

export interface Lifecycle {
  /** The script is running (it started, and has not been turned off or stopped). */
  readonly running: boolean
  /** The extension went away (reloaded): stop for good, and leave the page as it is. */
  stop(): void
}

export function runWhileEnabled(options: {
  enabled: Enabled
  /** Starts the content script; undefined on a page that is not Audible. */
  start(): Content | undefined
}): Lifecycle {
  let content: Content | undefined
  let stopped = false
  /** A change that arrived before the first read finished is newer than that read. */
  let changed = false

  function apply(enabled: boolean) {
    if (stopped) return
    if (enabled && !content) {
      content = options.start()
    } else if (!enabled && content) {
      content.remove()
      content = undefined
    }
  }

  const unwatch = options.enabled.watch(enabled => {
    changed = true
    apply(enabled)
  })
  options.enabled.read().then(
    enabled => {
      if (!changed) apply(enabled)
    },
    error => {
      // Storage is unreadable: the default is on, and an extension that shows nothing is worse.
      console.error('audible-ex: could not read the preferences', error)
      if (!changed) apply(true)
    }
  )

  return {
    get running() {
      return content !== undefined
    },
    stop() {
      stopped = true
      unwatch()
      content?.stop()
      content = undefined
    },
  }
}
