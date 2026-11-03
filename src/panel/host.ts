/**
 * Keeps the panel mounted exactly while the badge script has a handle for it (DECISIONS.md D18):
 * turning the extension off removes the handle and the panel with it; turning it on publishes a new
 * handle and the panel mounts again. Mounting is asynchronous (WXT builds the shadow root), so a
 * handle that is withdrawn or replaced while a mount is under way unmounts that mount when it ends.
 */
import type { PanelHandle } from '@/content/shared'

export interface MountedPanel {
  remove(): void
}

export function runPanel(options: {
  /** The shared-handle watcher (`watchHandle` on the page's document). */
  watch(listener: (handle: PanelHandle | undefined) => void): () => void
  /** Builds and mounts the panel for `handle`. */
  mount(handle: PanelHandle): Promise<MountedPanel>
  onError?(error: unknown): void
}): () => void {
  let shown: PanelHandle | undefined
  let mounted: MountedPanel | undefined
  /** Bumped on each change, so a mount that finishes late knows it is out of date. */
  let turn = 0

  const unmount = () => {
    mounted?.remove()
    mounted = undefined
    shown = undefined
  }

  const unwatch = options.watch(handle => {
    if (handle === shown) return
    unmount()
    const mine = ++turn
    if (!handle) return
    shown = handle
    options.mount(handle).then(
      panel => {
        if (turn === mine) mounted = panel
        else panel.remove()
      },
      error => {
        if (turn === mine) shown = undefined
        options.onError?.(error)
      }
    )
  })

  return () => {
    unwatch()
    turn++
    unmount()
  }
}
