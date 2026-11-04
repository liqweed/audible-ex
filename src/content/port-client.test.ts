import { describe, expect, test } from 'bun:test'
import {
  FakePort,
  ManualScheduler,
  notFound,
  ready,
} from '../../test/content-harness'
import type { BackgroundMessage } from '../schema/messages'
import {
  createPortClient,
  type LookupItem,
  type PortClient,
} from './port-client'

function setup(unresolved: LookupItem[] = []) {
  const ports: FakePort[] = []
  const timers = new ManualScheduler()
  const heard: BackgroundMessage[] = []
  let clock = 0
  let failConnect = 0
  const state = { unresolved }
  const client: PortClient = createPortClient({
    connect: () => {
      if (failConnect > 0) {
        failConnect--
        throw new Error('Extension context invalidated.')
      }
      const port = new FakePort()
      ports.push(port)
      return port
    },
    region: 'UK',
    page: 'search',
    unresolved: () => state.unresolved,
    onMessage: m => heard.push(m),
    schedule: timers.schedule,
    now: () => clock,
  })
  return {
    client,
    ports,
    timers,
    heard,
    state,
    advance: (ms: number) => {
      clock += ms
    },
    failNextConnects: (n: number) => {
      failConnect = n
    },
    get port() {
      return ports[ports.length - 1] as FakePort
    },
  }
}

const item = (asin: string, pinned = false) => ({ asin, pinned })

describe('port client', () => {
  test('connects on the first lookup and says Hello before it', () => {
    const t = setup()
    expect(t.ports).toHaveLength(0)
    t.client.lookup([item('B000000001'), item('B000000002', true)])
    expect(t.port.sent).toEqual([
      { _tag: 'Hello', region: 'UK', page: 'search' },
      {
        _tag: 'Lookup',
        items: [item('B000000001'), item('B000000002', true)],
      },
    ])
  })

  test('uses one connection for later messages and sends Retry as it is', () => {
    const t = setup()
    t.client.lookup([item('B000000001')])
    t.client.retry(['B000000001'])
    t.client.lookup([])
    expect(t.ports).toHaveLength(1)
    expect(t.port.sent.map(m => m._tag)).toEqual(['Hello', 'Lookup', 'Retry'])
    expect(t.port.sent[2]).toEqual({ _tag: 'Retry', asins: ['B000000001'] })
  })

  test('sends DetailsLookup once per ASIN, and nothing for none', () => {
    const t = setup()
    t.client.details([])
    expect(t.ports).toHaveLength(0)
    t.client.details(['B000000001', 'B000000001', 'B000000002'])
    expect(t.port.sent.at(-1)).toEqual({
      _tag: 'DetailsLookup',
      asins: ['B000000001', 'B000000002'],
    })
  })

  test('one item per ASIN: pinned if any is, rating only if all are', () => {
    const t = setup()
    t.client.lookup([
      { asin: 'B000000001', pinned: false, ratingOnly: true },
      { asin: 'B000000001', pinned: true, ratingOnly: true },
      { asin: 'B000000002', pinned: false, ratingOnly: true },
      { asin: 'B000000002', pinned: false },
    ])
    expect(t.port.sent.at(-1)).toEqual({
      _tag: 'Lookup',
      items: [
        { asin: 'B000000001', pinned: true, ratingOnly: true },
        { asin: 'B000000002', pinned: false },
      ],
    })
  })

  test('hands decoded background messages on', () => {
    const t = setup()
    t.client.lookup([item('B000000001')])
    t.port.receive(ready('B000000001', { r: 4, n: 10 }))
    t.port.receive(notFound('B000000002'))
    t.port.receive({
      _tag: 'Progress',
      queued: 1,
      active: 0,
      done: 0,
      cached: 0,
      notFound: 0,
      failed: 0,
    })
    expect(t.heard.map(m => m._tag)).toEqual([
      'BookUpdate',
      'BookUpdate',
      'Progress',
    ])
  })

  test('drops a message that does not decode, and keeps listening', () => {
    const t = setup()
    t.client.lookup([item('B000000001')])
    const warn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      t.port.receive({ _tag: 'BookUpdate', asin: 'nope', status: 'ready' })
      t.port.receive('garbage')
      t.port.receive(null)
    } finally {
      console.warn = warn
    }
    expect(t.heard).toEqual([])
    expect(warnings).toHaveLength(3)
    t.port.receive(notFound('B000000001'))
    expect(t.heard).toHaveLength(1)
  })

  describe('when the background worker stops', () => {
    test('reconnects after a short wait, says Hello and re-sends unresolved ASINs only', () => {
      const t = setup()
      t.client.lookup([
        item('B000000001'),
        item('B000000002'),
        item('B000000003'),
      ])
      // 1 is answered, 2 and 3 are not
      t.state.unresolved = [item('B000000002'), item('B000000003', true)]
      t.port.drop()
      expect(t.ports).toHaveLength(1)
      expect(t.timers.pending).toEqual([100])
      t.timers.runAll()
      expect(t.ports).toHaveLength(2)
      expect(t.port.sent).toEqual([
        { _tag: 'Hello', region: 'UK', page: 'search' },
        {
          _tag: 'Lookup',
          items: [item('B000000002'), item('B000000003', true)],
        },
      ])
    })

    test('lookup with no items opens no port, even after a drop', () => {
      const t = setup()
      t.client.lookup([item('B000000001')])
      t.state.unresolved = []
      t.port.drop()
      t.client.lookup([])
      t.client.retry([])
      expect(t.ports).toHaveLength(1)
      expect(t.timers.pending).toEqual([])
    })

    test('stays disconnected when nothing is unresolved, and connects on the next lookup', () => {
      const t = setup()
      t.client.lookup([item('B000000001')])
      t.state.unresolved = []
      t.port.drop()
      expect(t.timers.pending).toEqual([])
      t.client.lookup([item('B000000009')])
      expect(t.ports).toHaveLength(2)
      expect(t.port.sent.map(m => m._tag)).toEqual(['Hello', 'Lookup'])
    })

    test('a lookup on a new connection does not repeat what the reconnect sent', () => {
      const t = setup()
      t.client.lookup([item('B000000001')])
      t.state.unresolved = []
      t.port.drop()
      // the caller marks the new ASIN unresolved before asking, as main.ts does
      t.state.unresolved = [item('B000000009')]
      t.client.lookup([item('B000000009')])
      expect(t.port.lookups()).toEqual([['B000000009']])
    })

    test('a lookup on a new connection still asks for more than a rating-only re-send', () => {
      const t = setup([{ asin: 'B000000001', pinned: false, ratingOnly: true }])
      t.client.lookup([item('B000000001'), item('B000000002')])
      expect(t.port.sent.slice(1)).toEqual([
        {
          _tag: 'Lookup',
          items: [{ asin: 'B000000001', pinned: false, ratingOnly: true }],
        },
        { _tag: 'Lookup', items: [item('B000000001'), item('B000000002')] },
      ])
    })

    test('a cache-only re-send covers nothing deeper, and a deeper item covers it', () => {
      const t = setup([{ asin: 'B000000001', pinned: false, cacheOnly: true }])
      t.client.lookup([
        { asin: 'B000000001', pinned: false, ratingOnly: true },
        { asin: 'B000000001', pinned: false, cacheOnly: true },
      ])
      expect(t.port.sent.slice(1)).toEqual([
        {
          _tag: 'Lookup',
          items: [{ asin: 'B000000001', pinned: false, cacheOnly: true }],
        },
        {
          _tag: 'Lookup',
          items: [{ asin: 'B000000001', pinned: false, ratingOnly: true }],
        },
      ])
    })

    test('waits longer after each failed attempt, to 30 s, so a broken worker does not spin', () => {
      const t = setup([item('B000000001')])
      t.client.lookup([item('B000000001')])
      const delays: number[] = []
      for (let i = 0; i < 12; i++) {
        t.port.drop() // the new connection dies at once
        delays.push(...t.timers.pending)
        t.timers.runAll()
      }
      expect(delays).toEqual([
        100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 30000, 30000, 30000,
      ])
    })

    test('starts quick again after a connection that held', () => {
      const t = setup([item('B000000001')])
      t.client.lookup([item('B000000001')])
      t.port.drop()
      t.timers.runAll() // second connection, after 100 ms
      t.port.drop()
      expect(t.timers.pending).toEqual([200])
      t.timers.runAll()
      t.advance(60_000)
      t.port.drop()
      expect(t.timers.pending).toEqual([100])
    })

    test('a connection that heard from the background counts as healthy', () => {
      const t = setup([item('B000000001')])
      t.client.lookup([item('B000000001')])
      t.port.drop()
      t.timers.runAll()
      t.port.receive(notFound('B000000005'))
      t.port.drop()
      expect(t.timers.pending).toEqual([100])
    })

    test('keeps trying when connect throws (extension reloaded), with the same backoff', () => {
      const t = setup([item('B000000001')])
      t.client.lookup([item('B000000001')])
      const warn = console.warn
      console.warn = () => {}
      try {
        t.failNextConnects(2)
        t.port.drop()
        t.timers.runNext()
        expect(t.ports).toHaveLength(1)
        expect(t.timers.pending).toEqual([200])
        t.timers.runNext()
        expect(t.timers.pending).toEqual([400])
        t.timers.runNext()
        expect(t.ports).toHaveLength(2)
        expect(t.port.lookups()).toEqual([['B000000001']])
      } finally {
        console.warn = warn
      }
    })

    test('ignores late events from a replaced port', () => {
      const t = setup([item('B000000001')])
      t.client.lookup([item('B000000001')])
      const old = t.port
      old.drop()
      t.timers.runAll()
      old.receive(notFound('B000000001'))
      old.drop()
      expect(t.heard).toEqual([])
      expect(t.timers.pending).toEqual([])
    })

    test('a send on a port that closed unnoticed reconnects', () => {
      const t = setup([item('B000000001')])
      t.client.lookup([item('B000000001')])
      const warn = console.warn
      console.warn = () => {}
      try {
        t.port.closed = true // closed, but onDisconnect has not fired yet
        t.client.retry(['B000000001'])
      } finally {
        console.warn = warn
      }
      expect(t.timers.pending).toEqual([100])
    })
  })

  test('close ends the connection and every reconnect', () => {
    const t = setup([item('B000000001')])
    t.client.lookup([item('B000000001')])
    const port = t.port
    t.port.drop()
    t.client.close()
    t.timers.runAll()
    expect(t.ports).toHaveLength(1)
    t.client.lookup([item('B000000002')])
    expect(t.ports).toHaveLength(1)
    expect(port.sent).toHaveLength(2)
  })
})

test('pending prices reconnect even when every rating has resolved, and stop once answered', () => {
  const t = setup()
  t.client.prices(['B000000001'])
  expect(t.port.sent).toEqual([
    { _tag: 'Hello', region: 'UK', page: 'search' },
    { _tag: 'PriceLookup', asins: ['B000000001'] },
  ])
  t.port.drop()
  t.timers.runNext()
  expect(t.ports).toHaveLength(2)
  expect(t.port.sent[1]).toEqual({ _tag: 'PriceLookup', asins: ['B000000001'] })
  t.port.receive({ _tag: 'PriceUpdate', asin: 'B000000001' })
  t.port.drop()
  expect(t.timers.pending).toEqual([])
})
