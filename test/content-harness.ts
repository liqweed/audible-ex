/**
 * Fakes for the content script's DOM tests: a saved Audible page in happy-dom, an
 * IntersectionObserver and a timer that tests fire by hand, and a port that records what the
 * content script sends and plays back what the background would answer.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Content, type ContentDeps, startContent } from '@/content/main'
import type { ClientPort } from '@/content/port-client'
import type {
  CreateIntersectionObserver,
  IntersectionEntryLike,
} from '@/content/scanner'
import type { Schedule } from '@/content/schedule'
import type { BackgroundMessage } from '@/schema/messages'

const FIXTURES = join(import.meta.dir, 'fixtures/audible')

export type Marketplace = 'uk' | 'com'

export const fixtureHtml = (marketplace: Marketplace, page: string): string =>
  readFileSync(join(FIXTURES, marketplace, `${page}.html`), 'utf8')

/** Replaces the test document with a saved page (scripts are already stripped from fixtures). */
export function loadFixture(marketplace: Marketplace, page: string): void {
  document.documentElement.innerHTML = fixtureHtml(marketplace, page)
}

/** Replaces the test document with a hand-written body. */
export function loadBody(html: string): void {
  document.documentElement.innerHTML = `<head></head><body>${html}</body>`
}

// ---------- IntersectionObserver ----------

export class FakeIntersection {
  /** Elements being watched. */
  readonly observed = new Set<Element>()
  private callback: ((entries: IntersectionEntryLike[]) => void) | undefined
  rootMargin = ''

  readonly create: CreateIntersectionObserver = (callback, rootMargin) => {
    this.callback = callback
    this.rootMargin = rootMargin
    return {
      observe: target => {
        this.observed.add(target)
      },
      unobserve: target => {
        this.observed.delete(target)
      },
    }
  }

  /** Reports these elements (all watched ones by default) as inside the viewport margin. */
  intersect(targets: Iterable<Element> = [...this.observed]): void {
    this.callback?.(
      [...targets].map(target => ({ target, isIntersecting: true }))
    )
  }

  /** Reports these elements as outside. */
  leave(targets: Iterable<Element>): void {
    this.callback?.(
      [...targets].map(target => ({ target, isIntersecting: false }))
    )
  }
}

// ---------- timer ----------

interface Timer {
  fn: () => void
  ms: number
  cancelled: boolean
}

/** A `Schedule` whose timers fire when the test says so. */
export class ManualScheduler {
  private timers: Timer[] = []

  readonly schedule: Schedule = (fn, ms) => {
    const timer = { fn, ms, cancelled: false }
    this.timers.push(timer)
    return () => {
      timer.cancelled = true
    }
  }

  /** Delays of the timers that are waiting. */
  get pending(): number[] {
    return this.timers.filter(t => !t.cancelled).map(t => t.ms)
  }

  /** Fires the oldest waiting timer only. */
  runNext(): void {
    const timer = this.timers.find(t => !t.cancelled)
    if (!timer) return
    timer.cancelled = true
    timer.fn()
  }

  /** Fires every waiting timer, oldest first, including ones they schedule. */
  runAll(): void {
    while (this.timers.some(t => !t.cancelled)) {
      const timer = this.timers.find(t => !t.cancelled) as Timer
      timer.cancelled = true
      timer.fn()
    }
  }
}

// ---------- port ----------

export class FakePort implements ClientPort {
  readonly sent: Array<Record<string, unknown>> = []
  closed = false
  private readonly messageListeners: Array<(message: unknown) => void> = []
  private readonly disconnectListeners: Array<() => void> = []

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => {
      this.messageListeners.push(listener)
    },
  }
  readonly onDisconnect = {
    addListener: (listener: () => void) => {
      this.disconnectListeners.push(listener)
    },
  }

  postMessage(message: unknown): void {
    if (this.closed) throw new Error('Attempting to use a disconnected port')
    this.sent.push(message as Record<string, unknown>)
  }

  disconnect(): void {
    this.closed = true
  }

  /** What the background says. */
  receive(message: unknown): void {
    for (const listener of this.messageListeners) listener(message)
  }

  /** The background went away (an MV3 worker stop). */
  drop(): void {
    this.closed = true
    for (const listener of this.disconnectListeners) listener()
  }

  /** The `Lookup` messages sent, as ASIN lists. */
  lookups(): string[][] {
    return this.sent
      .filter(m => m._tag === 'Lookup')
      .map(m => (m.items as Array<{ asin: string }>).map(i => i.asin))
  }
}

export interface World {
  doc: Document
  io: FakeIntersection
  timers: ManualScheduler
  /** Every port the content script opened, oldest first. */
  ports: FakePort[]
  content: Content | undefined
  /** The current (latest) port. */
  port: FakePort
}

export interface WorldOptions {
  hostname?: string
  pathname?: string
  /** Called for each `connect`; throw to simulate an unreachable background. */
  onConnect?: (attempt: number) => void
  now?: () => number
}

/** The world started last; its listeners are on the shared test document until it is stopped. */
let previous: World | undefined

/**
 * Starts the content script on whatever the test document holds. The world a test started before
 * is stopped first: the document outlives the tests, and a script still listening on it would
 * answer events meant for the new one.
 */
export function startWorld(options: WorldOptions = {}): World {
  previous?.content?.stop()
  const io = new FakeIntersection()
  const timers = new ManualScheduler()
  const ports: FakePort[] = []
  const deps: ContentDeps = {
    doc: document,
    location: {
      hostname: options.hostname ?? 'www.audible.co.uk',
      pathname: options.pathname ?? '/',
    },
    connect: () => {
      options.onConnect?.(ports.length)
      const port = new FakePort()
      ports.push(port)
      return port
    },
    createIntersectionObserver: io.create,
    schedule: timers.schedule,
    css: '.agx-badge{}',
    overviewCss: '.tip{}',
    now: options.now,
  }
  const world: World = {
    doc: document,
    io,
    timers,
    ports,
    content: startContent(deps),
    get port() {
      return ports[ports.length - 1] as FakePort
    },
  }
  previous = world
  return world
}

// ---------- background messages ----------

export const loading = (asin: string): BackgroundMessage => ({
  _tag: 'BookUpdate',
  asin,
  status: 'loading',
})

export const ready = (
  asin: string,
  rating: { r: number; n: number; loose?: boolean },
  details?: { genres: string[]; year: number; desc?: string }
): BackgroundMessage => ({
  _tag: 'BookUpdate',
  asin,
  status: 'ready',
  rating: {
    r: rating.r,
    n: rating.n,
    url: `https://www.goodreads.com/book/show/${asin}`,
    loose: rating.loose ?? false,
  },
  ...(details && { details: { desc: '', ...details } }),
})

export const notFound = (asin: string): BackgroundMessage => ({
  _tag: 'BookUpdate',
  asin,
  status: 'notFound',
})

export const failed = (
  asin: string,
  message = 'HTTP 500'
): BackgroundMessage => ({
  _tag: 'BookUpdate',
  asin,
  status: 'failed',
  error: { reason: 'httpError', message },
})

// ---------- the page ----------

/** Badges that are not inside a hover popover. */
export const mainBadges = (root: ParentNode = document): Element[] =>
  [...root.querySelectorAll('.agx-badge')].filter(
    b => !b.closest('.bc-popover')
  )
