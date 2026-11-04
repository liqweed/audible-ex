/**
 * The label popover: hovering (or focusing) a genre label after a badge offers to hide books with
 * that label or to highlight them, or to stop when it is already hidden or highlighted. Plain DOM in a shadow root of
 * its own, like the hover overview (overview.ts), but this one takes the pointer so it can be
 * clicked: it stays while the pointer is on the label or on it, and goes a moment after the pointer
 * leaves both. Labels are found by one listener per event on the document, so they need no handlers
 * and a label that is redrawn keeps working.
 *
 * Everything shown is text, set as text. The popover does not know how filters are saved: it asks
 * `hide`, `highlight` or `release` and shows how that went.
 */
import { hasLabel } from '../core/filter'
import { LABEL } from './badges'
import { LABEL_HOST } from './cards'
import { placeOverview, popoverHead } from './overview'
import type { Schedule } from './schedule'

/** The pointer rests on a label this long before the popover appears, so passing over one does not. */
export const SHOW_DELAY_MS = 200
/** The popover stays this long after the pointer leaves, to give it time to reach the popover. */
export const HIDE_DELAY_MS = 250

export interface LabelPopover {
  /** Opens the popover for this label now. */
  show(label: Element): void
  hide(): void
  /** Stops listening and takes the host off the page. */
  stop(): void
}

export interface LabelPopoverOptions {
  doc: Document
  /** The popover's stylesheet text, applied inside the shadow root only. */
  css: string
  /** The extension's logo as an image URL, shown in the title row. */
  logo?: string
  schedule: Schedule
  /** The labels being filtered on now. */
  hiddenLabels(): readonly string[]
  /** The labels being highlighted now. */
  highlightLabels(): readonly string[]
  /** The user's master switch for the filters. */
  filtersEnabled(): boolean
  /** How many books on this page carry the label. */
  booksWith(label: string): number
  /**
   * Starts filtering on the label (and switches the filters on), and stops highlighting it.
   * Rejects if it could not be saved.
   */
  hide(label: string): Promise<void>
  /** Starts highlighting the label, and stops filtering on it. Rejects if it could not be saved. */
  highlight(label: string): Promise<void>
  /** Stops filtering on and highlighting the label. Rejects if it could not be saved. */
  release(label: string): Promise<void>
}

/** What the user does with a label now. */
type Use = 'hidden' | 'highlighted' | undefined

export const labelOf = (target: EventTarget | null): Element | null =>
  target instanceof Element ? target.closest(`.${LABEL}`) : null

const quote = (label: string) => `“${label}”`

export function createLabelPopover(options: LabelPopoverOptions): LabelPopover {
  const { doc } = options
  const win = doc.defaultView
  let host: HTMLElement | undefined
  let root: ShadowRoot | undefined
  let pop: HTMLElement | undefined
  /** The label pill the popover belongs to. */
  let current: Element | undefined
  let cancelShow: (() => void) | undefined
  let cancelHide: (() => void) | undefined
  /** Fixed once the popover is placed, so it does not jump when its text changes. */
  let at: { top: number; left: number } | undefined

  function mount(): ShadowRoot {
    if (root) return root
    host = doc.createElement('div')
    host.className = LABEL_HOST
    root = host.attachShadow({ mode: 'open' })
    const style = doc.createElement('style')
    style.textContent = options.css
    root.appendChild(style)
    ;(doc.body ?? doc.documentElement).appendChild(host)
    return root
  }

  const clearTimers = () => {
    cancelShow?.()
    cancelShow = undefined
    cancelHide?.()
    cancelHide = undefined
  }

  function hide() {
    clearTimers()
    pop?.remove()
    pop = undefined
    current = undefined
    at = undefined
  }

  const text = (tag: string, className: string, content: string) => {
    const el = doc.createElement(tag)
    if (className) el.className = className
    el.textContent = content
    return el
  }

  /** Draws the popover's content for `label`; `use` is what the user does with it, `status` how the last click went. */
  function render(
    label: string,
    use: Use,
    status?: { text: string; error?: boolean }
  ) {
    const next = doc.createElement('div')
    next.className = 'pop'
    next.setAttribute('role', 'dialog')
    next.setAttribute('aria-label', `Filter on ${label}`)
    next.append(popoverHead(doc, label, options.logo))
    const books = options.booksWith(label)
    if (books > 0) {
      next.append(
        text(
          'span',
          'meta',
          `${books} ${books === 1 ? 'book' : 'books'} on this page`
        )
      )
    }
    if (status) {
      const line = text(
        'span',
        status.error ? 'status error' : 'status',
        status.text
      )
      line.setAttribute('role', status.error ? 'alert' : 'status')
      next.append(line)
    }
    const action = (
      caption: string,
      save: () => Promise<void>,
      after: Use,
      done: string
    ) => {
      const button = doc.createElement('button')
      button.type = 'button'
      button.textContent = caption
      button.addEventListener('click', () => {
        for (const b of next.querySelectorAll('button')) b.disabled = true
        save().then(
          () => render(label, after, { text: done }),
          () =>
            render(label, use, {
              text: 'Could not save the filter. Try again.',
              error: true,
            })
        )
      })
      next.append(button)
    }
    if (use === 'hidden') {
      action(
        `Stop hiding ${quote(label)}`,
        () => options.release(label),
        undefined,
        `No longer hiding ${quote(label)}.`
      )
    } else if (use === 'highlighted') {
      action(
        `Stop highlighting ${quote(label)}`,
        () => options.release(label),
        undefined,
        `No longer highlighting ${quote(label)}.`
      )
    } else {
      action(
        `Hide books labelled ${quote(label)}`,
        () => options.hide(label),
        'hidden',
        `Hiding books labelled ${quote(label)}.`
      )
      action(
        `Highlight books labelled ${quote(label)}`,
        () => options.highlight(label),
        'highlighted',
        `Highlighting books labelled ${quote(label)}.`
      )
    }
    if (use === undefined && !options.filtersEnabled()) {
      next.append(
        text('span', 'meta', 'Filters are off; hiding switches them on.')
      )
    }

    if (pop) pop.replaceWith(next)
    else mount().appendChild(next)
    pop = next
    if (at) {
      next.style.top = `${at.top}px`
      next.style.left = `${at.left}px`
    }
  }

  function show(label: Element) {
    clearTimers()
    const name = label.textContent?.trim()
    if (!name) return
    if (pop && current === label) return
    pop?.remove()
    pop = undefined
    at = undefined
    current = label
    render(
      name,
      hasLabel(options.hiddenLabels(), name)
        ? 'hidden'
        : hasLabel(options.highlightLabels(), name)
          ? 'highlighted'
          : undefined
    )
    // Measured where it is going to be, after it has its text.
    if (pop) {
      const box = (pop as HTMLElement).getBoundingClientRect()
      at = placeOverview(label.getBoundingClientRect(), box, {
        width: win?.innerWidth ?? 0,
        height: win?.innerHeight ?? 0,
      })
      ;(pop as HTMLElement).style.top = `${at.top}px`
      ;(pop as HTMLElement).style.left = `${at.left}px`
    }
  }

  const scheduleHide = () => {
    cancelHide?.()
    cancelHide = options.schedule(hide, HIDE_DELAY_MS)
  }

  const onOver = (event: Event) => {
    const target = event.target
    // The popover's shadow root is closed off from the page: its events arrive from the host.
    if (target === host) {
      cancelHide?.()
      cancelHide = undefined
      return
    }
    const label = labelOf(target)
    if (label) {
      cancelHide?.()
      cancelHide = undefined
      if (label !== current) {
        cancelShow?.()
        cancelShow = options.schedule(() => show(label), SHOW_DELAY_MS)
      }
      return
    }
    cancelShow?.()
    cancelShow = undefined
    if (pop) scheduleHide()
  }

  /** Set while Escape gives the focus back to the label, so that focus change does not reopen the popover. */
  let returningFocus = false

  const onFocusIn = (event: Event) => {
    if (returningFocus) return
    const label = labelOf(event.target)
    if (label) show(label)
  }

  const onKeyDown = (event: Event) => {
    const key = (event as KeyboardEvent).key
    if (key === 'Escape' && pop) {
      const pill = current
      hide()
      returningFocus = true
      try {
        if (pill instanceof HTMLElement) pill.focus()
      } finally {
        returningFocus = false
      }
      return
    }
    const label = labelOf(event.target)
    if (label && (key === 'Enter' || key === ' ')) {
      event.preventDefault()
      show(label)
      root?.querySelector('button')?.focus()
    }
  }

  // Fixed to the window, so any scroll, in the page or in a container, leaves it behind.
  const onScroll = () => hide()

  doc.addEventListener('mouseover', onOver)
  doc.addEventListener('focusin', onFocusIn)
  doc.addEventListener('keydown', onKeyDown)
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true })

  return {
    show,
    hide,
    stop() {
      doc.removeEventListener('mouseover', onOver)
      doc.removeEventListener('focusin', onFocusIn)
      doc.removeEventListener('keydown', onKeyDown)
      doc.removeEventListener('scroll', onScroll, { capture: true })
      hide()
      host?.remove()
      host = undefined
      root = undefined
    },
  }
}
