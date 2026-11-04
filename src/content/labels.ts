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

/** The popover's three choices, in order. */
const CHOICES = ['hide', 'show', 'highlight'] as const
type Choice = (typeof CHOICES)[number]
const CAPTION: Record<Choice, string> = {
  hide: 'Hide',
  show: 'Show',
  highlight: 'Highlight',
}
const USE: Record<Choice, Use> = {
  hide: 'hidden',
  show: undefined,
  highlight: 'highlighted',
}
/** What the status line says once a choice is saved; `before` is what the label was. */
const DONE: Record<Choice, (label: string, before: Use) => string> = {
  hide: label => `Hiding books labelled ${quote(label)}.`,
  highlight: label => `Highlighting books labelled ${quote(label)}.`,
  show: (label, before) =>
    before === 'highlighted'
      ? `No longer highlighting ${quote(label)}.`
      : `No longer hiding ${quote(label)}.`,
}
const HELP =
  'Hide takes books with this genre off the page, or dims them, as your filter settings say. ' +
  'Highlight makes their covers shine. Show does neither. It applies on every Audible page.'

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
    // Hide, show or highlight: one choice of three, as radio buttons drawn as one bar (the panel's).
    const choice = doc.createElement('fieldset')
    choice.className = 'choice'
    const legend = text('legend', 'sr', `Books labelled ${quote(label)}`)
    choice.append(legend)
    const current: Choice =
      use === 'hidden' ? 'hide' : use === 'highlighted' ? 'highlight' : 'show'
    for (const value of CHOICES) {
      const item = doc.createElement('label')
      const input = doc.createElement('input')
      input.type = 'radio'
      input.name = 'agx-label-use'
      input.value = value
      input.checked = value === current
      input.addEventListener('change', () => {
        if (!input.checked) return
        for (const i of choice.querySelectorAll('input')) i.disabled = true
        const save =
          value === 'hide'
            ? options.hide(label)
            : value === 'highlight'
              ? options.highlight(label)
              : options.release(label)
        save.then(
          () => render(label, USE[value], { text: DONE[value](label, use) }),
          () =>
            render(label, use, {
              text: 'Could not save the filter. Try again.',
              error: true,
            })
        )
      })
      item.append(input, doc.createTextNode(CAPTION[value]))
      choice.append(item)
    }
    const info = doc.createElement('button')
    info.type = 'button'
    info.className = 'info'
    info.textContent = 'i'
    info.setAttribute('aria-label', 'About hide and highlight')
    info.setAttribute('aria-expanded', 'false')
    const help = text('span', 'help', HELP)
    help.id = 'agx-label-help'
    help.hidden = true
    info.setAttribute('aria-controls', help.id)
    const showHelp = (open: boolean) => {
      help.hidden = !open
      info.setAttribute('aria-expanded', String(open))
    }
    info.addEventListener('pointerenter', () => showHelp(true))
    info.addEventListener('pointerleave', () => showHelp(false))
    info.addEventListener('focus', () => showHelp(true))
    info.addEventListener('blur', () => showHelp(false))
    // Hovering or focusing opens it first, so a click only opens it (a tap, on touch).
    info.addEventListener('click', () => showHelp(true))
    const row = doc.createElement('div')
    row.className = 'row'
    row.append(choice, info)
    next.append(row, help)

    if (status) {
      const line = text(
        'span',
        status.error ? 'status error' : 'status',
        status.text
      )
      line.setAttribute('role', status.error ? 'alert' : 'status')
      next.append(line)
    }
    if (use !== 'hidden' && !options.filtersEnabled()) {
      next.append(
        text('span', 'note', 'Filters are off; Hide switches them on.')
      )
    }

    // A choice made from the keyboard keeps the focus on the choice it moved to.
    const hadFocus = !!pop && !!root && pop.contains(root.activeElement)
    if (pop) pop.replaceWith(next)
    else mount().appendChild(next)
    pop = next
    if (at) {
      next.style.top = `${at.top}px`
      next.style.left = `${at.left}px`
    }
    if (hadFocus) next.querySelector<HTMLElement>('input:checked')?.focus()
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
      root?.querySelector<HTMLElement>('input:checked')?.focus()
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
