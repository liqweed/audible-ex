import { describe, expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { TestClock } from 'effect/testing'
import { BackgroundMessage } from '../schema/messages'
import {
  CircuitOpen,
  FormatChanged,
  HttpError,
  NoMetadata,
  RateLimited,
} from './errors'
import { LookupQueue } from './LookupQueue'
import {
  asin,
  type Behaviour,
  type Call,
  detailsFor,
  fakes,
  latch,
  type MemoryCache,
  matchFor,
  memoryCache,
  settle,
} from './LookupTest'
import { PortServer, type PortServerService, reasonOf } from './PortServer'
import type { PortLike } from './port'

/** A `runtime.Port` the test drives by hand; like the browser's, it throws once disconnected. */
class FakePort implements PortLike {
  readonly name = 'agx'
  readonly sent: Array<Record<string, unknown>> = []
  connected = true
  private readonly messageListeners: Array<(message: unknown) => void> = []
  private readonly disconnectListeners: Array<() => void> = []

  postMessage(message: unknown) {
    if (!this.connected) {
      throw new Error('Attempting to use a disconnected port object')
    }
    this.sent.push(message as Record<string, unknown>)
  }
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

  /** The content script says something. */
  say(message: unknown) {
    for (const listener of this.messageListeners) listener(message)
  }
  /** The tab closes, or the worker restarts. */
  disconnect() {
    this.connected = false
    for (const listener of this.disconnectListeners) listener()
  }
  /** `asin:status` of every update so far. */
  get updates() {
    return this.sent.map(m => `${m.asin}:${m.status}`)
  }
}

const hello = { _tag: 'Hello', region: 'US', page: 'search' }
const lookup = (...asins: number[]) => ({
  _tag: 'Lookup',
  items: asins.map(n => ({ asin: asin(n), pinned: false })),
})

interface Log {
  readonly level: string
  readonly text: string
}

interface Harness {
  readonly server: PortServerService
  readonly calls: Call[]
  readonly cache: MemoryCache
  readonly logs: Log[]
  /** A new tab's port, accepted and left to run. */
  readonly connect: () => Effect.Effect<FakePort>
}

const capture = (logs: Log[]) =>
  Logger.layer([
    Logger.make(({ logLevel, message }) => {
      logs.push({
        level: logLevel,
        text: (Array.isArray(message) ? message : [message])
          .map(String)
          .join(' '),
      })
    }),
  ])

/** The server over a queue over fake services, on a `TestClock`; logs are captured. */
const harness = (
  behaviour: Behaviour = {},
  cache: MemoryCache = memoryCache()
) => {
  const fake = fakes(behaviour)
  const logs: Log[] = []
  const deps = Layer.merge(cache.layer, fake.layer).pipe(
    Layer.provideMerge(TestClock.layer()),
    Layer.provideMerge(capture(logs))
  )
  const layer = PortServer.layer.pipe(
    Layer.provideMerge(LookupQueue.layer),
    Layer.provideMerge(deps)
  )
  const run = <A>(body: (h: Harness) => Effect.Effect<A, unknown>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* PortServer
        return yield* body({
          server,
          calls: fake.calls,
          cache,
          logs,
          connect: () =>
            Effect.gen(function* () {
              const port = new FakePort()
              yield* server.accept(port)
              return port
            }),
        })
      }).pipe(Effect.provide(layer))
    )
  return { run, calls: fake.calls, logs, cache }
}

const scenario = (
  name: string,
  behaviour: Behaviour,
  body: (h: Harness) => Effect.Effect<void, unknown>
) => test(name, () => harness(behaviour).run(body))

const searches = (calls: Call[]) => calls.filter(c => c.kind === 'search')

describe('PortServer lookups', () => {
  scenario(
    'looks a book up: loading, then ready with the rating, then with details',
    {},
    h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1))
        yield* TestClock.adjust(0)
        yield* settle
        expect(port.sent).toEqual([
          { _tag: 'BookUpdate', asin: asin(1), status: 'loading' },
          {
            _tag: 'BookUpdate',
            asin: asin(1),
            status: 'ready',
            rating: {
              r: 4.25,
              n: 1234,
              url: matchFor(1).url,
              loose: false,
            },
          },
          {
            _tag: 'BookUpdate',
            asin: asin(1),
            status: 'ready',
            rating: {
              r: 4.25,
              n: 1234,
              url: matchFor(1).url,
              loose: false,
            },
            details: detailsFor(1),
          },
        ])
      })
  )

  scenario(
    'answers a book cached with its details at once, in one update',
    {},
    h =>
      Effect.gen(function* () {
        h.cache.ratings.set(asin(1), {
          _tag: 'Found',
          asin: asin(1),
          savedAt: 0,
          ...matchFor(1),
          r: 3.9,
          n: 77,
        })
        h.cache.details.set(matchFor(1).bookId, {
          bookId: matchFor(1).bookId,
          savedAt: 0,
          ...detailsFor(1),
        })
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1))
        yield* settle
        expect(port.sent).toEqual([
          {
            _tag: 'BookUpdate',
            asin: asin(1),
            status: 'ready',
            rating: { r: 3.9, n: 77, url: matchFor(1).url, loose: false },
            details: detailsFor(1),
          },
        ])
        expect(h.calls).toEqual([])
      })
  )

  scenario(
    'answers a cached rating at once, and sends the details when they arrive',
    {},
    h =>
      Effect.gen(function* () {
        h.cache.ratings.set(asin(1), {
          _tag: 'Found',
          asin: asin(1),
          savedAt: 0,
          bookId: matchFor(1).bookId,
          r: 4.25,
          n: 1234,
          url: matchFor(1).url,
          loose: false,
        })
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1))
        yield* settle
        expect(port.updates).toEqual([`${asin(1)}:ready`, `${asin(1)}:ready`])
        expect(port.sent[0]?.details).toBeUndefined()
        expect(port.sent[1]?.details).toEqual(detailsFor(1))
        expect(h.calls.map(c => c.kind)).toEqual(['details'])
      })
  )

  scenario('says notFound at once for a cached miss', {}, h =>
    Effect.gen(function* () {
      h.cache.ratings.set(asin(1), { _tag: 'Miss', asin: asin(1), savedAt: 0 })
      const port = yield* h.connect()
      port.say(hello)
      port.say(lookup(1))
      yield* settle
      expect(port.updates).toEqual([`${asin(1)}:notFound`])
    })
  )

  scenario(
    'says loading, then notFound, for a book that is not on Goodreads',
    {
      search: () => Effect.succeedNone,
    },
    h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1))
        yield* settle
        expect(port.updates).toEqual([
          `${asin(1)}:loading`,
          `${asin(1)}:notFound`,
        ])
      })
  )

  scenario('records a pin for a pinned row', {}, h =>
    Effect.gen(function* () {
      const port = yield* h.connect()
      port.say(hello)
      port.say({ _tag: 'Lookup', items: [{ asin: asin(1), pinned: true }] })
      yield* settle
      expect(h.cache.pins).toEqual([asin(1)])
    })
  )

  scenario(
    'keeps the rating when only the details fail',
    {
      details: () =>
        Effect.fail(new FormatChanged({ source: 'bookPage', detail: 'x' })),
    },
    h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1))
        yield* settle
        expect(port.updates).toEqual([`${asin(1)}:loading`, `${asin(1)}:ready`])
        expect(
          h.logs.some(l => l.level === 'Warn' && l.text.includes('Details'))
        ).toBe(true)
      })
  )
})

describe('PortServer failures', () => {
  scenario(
    'sends failed with the reason, and Retry looks the book up again',
    {
      search: (n, call) =>
        call === 1
          ? Effect.fail(
              new HttpError({ status: 500, url: 'u', cause: undefined })
            )
          : Effect.succeedSome(matchFor(n)),
    },
    h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1))
        yield* settle
        expect(port.updates).toEqual([
          `${asin(1)}:loading`,
          `${asin(1)}:failed`,
        ])
        expect(port.sent[1]?.error).toEqual({
          reason: 'httpError',
          message: 'HTTP 500 from u',
        })

        yield* TestClock.adjust(250)
        port.say({ _tag: 'Retry', asins: [asin(1)] })
        yield* settle
        expect(port.updates.slice(2)).toEqual([
          `${asin(1)}:loading`,
          `${asin(1)}:ready`,
          `${asin(1)}:ready`,
        ])
        expect(searches(h.calls)).toHaveLength(2)
      })
  )

  scenario(
    'says noMetadata when Audible does not carry the ASIN',
    {
      catalog: a => Effect.fail(new NoMetadata({ asin: a })),
    },
    h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1))
        yield* settle
        expect(port.sent[1]).toMatchObject({
          status: 'failed',
          error: { reason: 'noMetadata' },
        })
      })
  )

  scenario(
    'says formatChanged when Goodreads changed its format',
    {
      search: () =>
        Effect.fail(new FormatChanged({ source: 'autocomplete', detail: 'x' })),
    },
    h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1))
        yield* settle
        expect(port.sent[1]).toMatchObject({
          status: 'failed',
          error: { reason: 'formatChanged' },
        })
      })
  )

  test('names the reason of every error, and of the failure behind an open breaker', () => {
    const http = new HttpError({ status: 0, url: 'u', cause: undefined })
    const limited = new RateLimited({
      status: 429,
      url: 'u',
      retryAfter: undefined,
    })
    const changed = new FormatChanged({ source: 'bookPage', detail: 'x' })
    expect(reasonOf(http)).toBe('httpError')
    expect(reasonOf(limited)).toBe('rateLimited')
    expect(reasonOf(changed)).toBe('formatChanged')
    expect(reasonOf(new NoMetadata({ asin: asin(1) }))).toBe('noMetadata')
    expect(
      reasonOf(new CircuitOpen({ lastFailure: limited, reopensAt: 1 }))
    ).toBe('rateLimited')
    expect(
      reasonOf(new CircuitOpen({ lastFailure: changed, reopensAt: 1 }))
    ).toBe('formatChanged')
  })

  scenario('every update it sends is valid for the content script', {}, h =>
    Effect.gen(function* () {
      const port = yield* h.connect()
      port.say(hello)
      port.say(lookup(1, 2))
      yield* settle
      expect(port.sent.length).toBeGreaterThan(0)
      for (const message of port.sent) {
        expect(() =>
          Schema.decodeUnknownSync(BackgroundMessage)(message)
        ).not.toThrow()
      }
    })
  )
})

describe('PortServer with several tabs', () => {
  const gate = latch()

  scenario(
    'two ports asking for one ASIN cause one lookup, and both get the update',
    {
      search: n => gate.wait.pipe(Effect.as(Option.some(matchFor(n)))),
    },
    h =>
      Effect.gen(function* () {
        const a = yield* h.connect()
        const b = yield* h.connect()
        for (const port of [a, b]) {
          port.say(hello)
          port.say(lookup(1))
        }
        yield* settle
        expect(a.updates).toEqual([`${asin(1)}:loading`])
        expect(b.updates).toEqual([`${asin(1)}:loading`])
        yield* gate.open
        yield* settle
        for (const port of [a, b]) {
          expect(port.updates).toEqual([
            `${asin(1)}:loading`,
            `${asin(1)}:ready`,
            `${asin(1)}:ready`,
          ])
          expect(port.sent.at(-1)?.details).toEqual(detailsFor(1))
        }
        expect(searches(h.calls)).toHaveLength(1)
        expect(h.calls.filter(c => c.kind === 'catalog')).toHaveLength(1)
        expect(h.calls.filter(c => c.kind === 'details')).toHaveLength(1)
      })
  )

  const held = latch()
  scenario(
    'a port that disconnects loses only its own interest',
    {
      search: n => held.wait.pipe(Effect.as(Option.some(matchFor(n)))),
    },
    h =>
      Effect.gen(function* () {
        const gone = yield* h.connect()
        gone.say(hello)
        gone.say(lookup(1))
        yield* settle
        const stays = yield* h.connect()
        stays.say(hello)
        stays.say(lookup(1))
        yield* settle
        gone.disconnect()
        yield* settle
        yield* held.open
        yield* settle
        // The tab that stayed got everything; the one that left got nothing more, and nothing threw.
        expect(stays.updates).toEqual([
          `${asin(1)}:loading`,
          `${asin(1)}:ready`,
          `${asin(1)}:ready`,
        ])
        expect(gone.updates).toEqual([`${asin(1)}:loading`])
        expect(searches(h.calls)).toHaveLength(1)
      })
  )

  scenario(
    'a port that disconnected stops being served: later messages are ignored',
    {},
    h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        yield* settle
        port.disconnect()
        port.say(lookup(1))
        yield* settle
        expect(h.calls).toEqual([])
      })
  )
})

describe('PortServer messages', () => {
  scenario(
    'drops a message that does not decode, logs it, and keeps working',
    {},
    h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say('not even an object')
        port.say({
          _tag: 'Lookup',
          items: [{ asin: 'lowercase', pinned: false }],
        })
        port.say({ _tag: 'Progress' })
        port.say(null)
        port.say(lookup(1))
        yield* settle
        const warnings = h.logs.filter(
          l => l.level === 'Warn' && l.text.includes('does not decode')
        )
        expect(warnings).toHaveLength(4)
        // The port was not closed or confused: the good message after the bad ones was served.
        expect(port.connected).toBe(true)
        expect(port.updates).toEqual([
          `${asin(1)}:loading`,
          `${asin(1)}:ready`,
          `${asin(1)}:ready`,
        ])
      })
  )

  scenario('drops a Lookup that comes before Hello, and logs it', {}, h =>
    Effect.gen(function* () {
      const port = yield* h.connect()
      port.say(lookup(1))
      yield* settle
      expect(port.sent).toEqual([])
      expect(h.calls).toEqual([])
      expect(
        h.logs.some(l => l.level === 'Warn' && l.text.includes('before Hello'))
      ).toBe(true)
      port.say(hello)
      port.say(lookup(1))
      yield* settle
      expect(port.updates[0]).toBe(`${asin(1)}:loading`)
    })
  )

  const held = latch()
  scenario(
    'a repeated Hello or Lookup for an ASIN in flight starts nothing new',
    {
      search: n => held.wait.pipe(Effect.as(Option.some(matchFor(n)))),
    },
    h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1))
        port.say(hello)
        port.say(lookup(1, 2))
        port.say({ _tag: 'Retry', asins: [asin(2)] })
        yield* settle
        expect(port.updates).toEqual([
          `${asin(1)}:loading`,
          `${asin(2)}:loading`,
        ])
        yield* held.open
        yield* TestClock.adjust(250)
        yield* settle
        expect(searches(h.calls)).toHaveLength(2)
        expect(port.updates.filter(u => u.endsWith(':loading'))).toHaveLength(2)
      })
  )
})

describe('PortServer after a reconnect', () => {
  test('a new port that re-sends what was unresolved is answered from the cache where it can be', async () => {
    const cache = memoryCache()

    // The first worker: book 1 resolves, book 2 is still being looked up when the worker stops.
    const first = harness(
      {
        search: n => (n === 2 ? Effect.never : Effect.succeedSome(matchFor(n))),
      },
      cache
    )
    await first.run(h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1, 2))
        yield* settle
        expect(port.updates).toContain(`${asin(1)}:ready`)
        expect(port.updates).not.toContain(`${asin(2)}:ready`)
      })
    )
    expect(cache.ratings.has(asin(1))).toBe(true)
    expect(cache.ratings.has(asin(2))).toBe(false)

    // The worker restarts: a new runtime and queue over the same cache. The content script
    // reconnects and sends Hello and both ASINs again.
    const second = harness({}, cache)
    await second.run(h =>
      Effect.gen(function* () {
        const port = yield* h.connect()
        port.say(hello)
        port.say(lookup(1, 2))
        yield* settle
        expect(port.updates).toContain(`${asin(1)}:ready`)
        expect(port.updates).toContain(`${asin(2)}:ready`)
        // Book 1 came from the cache. Book 2's metadata was cached before the old worker stopped,
        // so only its Goodreads search was repeated.
        expect(h.calls.filter(c => c.kind === 'catalog')).toEqual([])
        expect(searches(h.calls)).toHaveLength(1)
      })
    )
  })
})
