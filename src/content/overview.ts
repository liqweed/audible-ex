/**
 * The hover overview (`showTip` in the userscript): the Goodreads rating line, up to six genres and
 * the overview text in a box next to the badge under the pointer. It is drawn inside a shadow root,
 * so Audible's styles cannot change it and it cannot change Audible's; the floating panel will
 * mount in the same root (ARCHITECTURE.md §6). Plain DOM, no React.
 *
 * One listener per event on the document finds the badge, so badges need no handlers of their own
 * and a re-rendered badge keeps working. The book is read when the pointer arrives, which is why a
 * year or overview that came in after the badge was drawn shows on the next hover.
 */
import { BADGE } from './badges'
import { type BookView, hasOverview, type WithOverview } from './books'
import { OVERVIEW_HOST } from './cards'

/** Genres in the overview; the labels after the badge show fewer. */
export const OVERVIEW_GENRES = 6
/** Gap between the badge and the box, and between the box and the window's edge. */
const GAP = 6
const MARGIN = 8

export interface Size {
  readonly width: number
  readonly height: number
}

/** The part of a `DOMRect` that placing needs. */
export interface Box extends Size {
  readonly top: number
  readonly bottom: number
  readonly left: number
}

/**
 * Where the box goes, in viewport coordinates: below the badge, or above it when it would run off
 * the bottom edge, and as near the badge's left edge as the window allows.
 */
export function placeOverview(
  anchor: Box,
  box: Size,
  viewport: Size
): { top: number; left: number } {
  let top = anchor.bottom + GAP
  if (top + box.height > viewport.height - MARGIN)
    top = Math.max(MARGIN, anchor.top - box.height - GAP)
  const left = Math.max(
    MARGIN,
    Math.min(anchor.left, viewport.width - box.width - MARGIN)
  )
  return { top, left }
}

/** `★ 4.21 · 12,345 ratings · first published 2019 (approximate match)`. */
export function ratingLine(
  { rating, details }: WithOverview,
  showYear = true
): string {
  const parts = [
    `★ ${rating.r.toFixed(2)}`,
    `${rating.n.toLocaleString()} ratings`,
  ]
  // 0 is "Goodreads has no date"; a negative year is a real one.
  if (showYear && details.year) parts.push(`first published ${details.year}`)
  return parts.join(' · ') + (rating.loose ? ' (approximate match)' : '')
}

export interface Overview {
  /** Draws the box for this badge, or does nothing if the book has no overview. */
  show(badge: Element, view: BookView | undefined): void
  hide(): void
  /** Stops listening and takes the host off the page. */
  stop(): void
  /** The shadow root, once something has been shown; the panel will share it. */
  readonly root: ShadowRoot | undefined
}

export interface OverviewOptions {
  doc: Document
  /** The overview's stylesheet text, applied inside the shadow root only. */
  css: string
  enabled?(): boolean
  showYear?(): boolean
  /** The book a badge shows, read when the pointer arrives. */
  viewOf(badge: Element): BookView | undefined
}

/** Starts listening on the document; the host and shadow root are made on the first show. */
export function createOverview(options: OverviewOptions): Overview {
  const { doc } = options
  const win = doc.defaultView
  let root: ShadowRoot | undefined
  let tip: HTMLElement | undefined
  /** The badge the box belongs to. */
  let current: Element | undefined

  function mount(): ShadowRoot {
    if (root) return root
    const host = doc.createElement('div')
    host.className = OVERVIEW_HOST
    root = host.attachShadow({ mode: 'open' })
    const style = doc.createElement('style')
    style.textContent = options.css
    root.appendChild(style)
    ;(doc.body ?? doc.documentElement).appendChild(host)
    return root
  }

  function hide() {
    tip?.remove()
    tip = undefined
    current = undefined
  }

  function show(badge: Element, view: BookView | undefined) {
    hide()
    if (options.enabled?.() === false || !hasOverview(view)) return
    const box = doc.createElement('div')
    box.className = 'tip'
    box.setAttribute('role', 'tooltip')
    // Everything below is text from Goodreads: set as text, never as markup.
    const line = doc.createElement('b')
    line.textContent = ratingLine(view, options.showYear?.() ?? true)
    box.appendChild(line)
    const genres = view.details.genres.slice(0, OVERVIEW_GENRES)
    if (genres.length > 0) {
      const meta = doc.createElement('span')
      meta.className = 'meta'
      meta.textContent = genres.join(' · ')
      box.appendChild(meta)
    }
    const body = doc.createElement('span')
    body.textContent = view.details.desc
    const fade = doc.createElement('span')
    fade.className = 'fade'
    box.append(body, fade)
    mount().appendChild(box)

    // The box is measured where it is going to be, after it has its text.
    const at = placeOverview(
      badge.getBoundingClientRect(),
      box.getBoundingClientRect(),
      { width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0 }
    )
    box.style.top = `${at.top}px`
    box.style.left = `${at.left}px`
    tip = box
    current = badge
  }

  const badgeOf = (target: EventTarget | null): Element | null =>
    target instanceof Element ? target.closest(`.${BADGE}`) : null

  const onOver = (event: Event) => {
    // A badge removed while hovered never says mouseout; the next move of the pointer ends the box.
    if (current && !current.isConnected) hide()
    const badge = badgeOf(event.target)
    // Moving between the parts of one badge must not redraw the box.
    if (badge && badge !== current) show(badge, options.viewOf(badge))
  }
  const onOut = (event: Event) => {
    if (!current) return
    const to = (event as MouseEvent).relatedTarget
    if (!(to instanceof Node && current.contains(to))) hide()
  }
  // The box is fixed to the window, so any scroll, in the page or in a container, leaves it behind.
  const onScroll = () => hide()

  doc.addEventListener('mouseover', onOver)
  doc.addEventListener('mouseout', onOut)
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true })

  return {
    show,
    hide,
    stop() {
      doc.removeEventListener('mouseover', onOver)
      doc.removeEventListener('mouseout', onOut)
      doc.removeEventListener('scroll', onScroll, { capture: true })
      hide()
      root?.host.remove()
      root = undefined
    },
    get root() {
      return root
    },
  }
}
