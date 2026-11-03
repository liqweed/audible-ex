/**
 * How the badge script hands the panel script its state (DECISIONS.md D19). Both are content
 * scripts of this extension in the same frame, so they share one isolated world: the badge script
 * sets a handle on `globalThis` and announces it with an event on the document; the panel script
 * reads it and listens for the next one (the extension is switched off and on, which starts the
 * badge script again). Neither script opens a second port, so there is one session and one set of
 * `Progress` counters per tab.
 *
 * The event carries nothing: a page script that hears it learns only that the extension is there,
 * which its own DOM changes already say. Plain TypeScript, so the badge script can import it
 * without React.
 */
import type { Store } from '@tanstack/store'
import type { ContentState } from './books'

/** What the panel may read and ask of the badge script. */
export interface PanelHandle {
  /** Books and progress; the panel selects from it (read only). */
  readonly state: Store<ContentState>
  /** Looks up again every book whose lookup failed. */
  retryFailed(): void
}

const KEY = Symbol.for('audible-ex.panel-handle')
export const HANDLE_EVENT = 'agx:panel-handle'

type Shared = { [KEY]?: PanelHandle }

export const currentHandle = (): PanelHandle | undefined =>
  (globalThis as Shared)[KEY]

/** Makes `handle` the one the panel shows, and tells the panel script. */
export function publishHandle(doc: Document, handle: PanelHandle): void {
  ;(globalThis as Shared)[KEY] = handle
  doc.dispatchEvent(new Event(HANDLE_EVENT))
}

/** Takes `handle` back, unless a newer one has replaced it. */
export function withdrawHandle(doc: Document, handle: PanelHandle): void {
  if (currentHandle() !== handle) return
  ;(globalThis as Shared)[KEY] = undefined
  doc.dispatchEvent(new Event(HANDLE_EVENT))
}

/**
 * Calls `listener` with the handle now (undefined if there is none yet) and again at each change.
 * Returns the function that stops listening.
 */
export function watchHandle(
  doc: Document,
  listener: (handle: PanelHandle | undefined) => void
): () => void {
  const tell = () => listener(currentHandle())
  doc.addEventListener(HANDLE_EVENT, tell)
  tell()
  return () => doc.removeEventListener(HANDLE_EVENT, tell)
}
