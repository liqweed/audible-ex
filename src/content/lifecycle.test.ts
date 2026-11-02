import { describe, expect, spyOn, test } from 'bun:test'
import {
  loadBody,
  mainBadges,
  ready,
  startWorld,
} from '../../test/content-harness'
import { type Enabled, runWhileEnabled } from './lifecycle'
import type { Content } from './main'

/** A switch the test flips by hand. */
function fakeSwitch(initial: boolean | Error) {
  const listeners = new Set<(enabled: boolean) => void>()
  let resolveRead: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    resolveRead = resolve
  })
  const enabled: Enabled = {
    read: async () => {
      await gate
      if (initial instanceof Error) throw initial
      return initial
    },
    watch: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    enabled,
    /** The first read answers. */
    answer: () => resolveRead(),
    set: (value: boolean) => {
      for (const listener of [...listeners]) listener(value)
    },
    get watchers() {
      return listeners.size
    },
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

/** A content script that records what was done to it. */
function fakeContent() {
  const log: string[] = []
  const content: Content = {
    books: undefined as never,
    stop: () => log.push('stop'),
    remove: () => log.push('remove'),
  }
  return { content, log }
}

describe('runWhileEnabled', () => {
  test('starts when the switch is on, and not when it is off', async () => {
    for (const [initial, starts] of [
      [true, 1],
      [false, 0],
    ] as const) {
      const sw = fakeSwitch(initial)
      let started = 0
      runWhileEnabled({
        enabled: sw.enabled,
        start: () => {
          started++
          return fakeContent().content
        },
      })
      sw.answer()
      await tick()
      expect(started).toBe(starts)
    }
  })

  test('turning it off removes the page changes; turning it on starts again', async () => {
    const sw = fakeSwitch(true)
    const made: ReturnType<typeof fakeContent>[] = []
    const life = runWhileEnabled({
      enabled: sw.enabled,
      start: () => {
        const c = fakeContent()
        made.push(c)
        return c.content
      },
    })
    sw.answer()
    await tick()
    expect(life.running).toBe(true)

    sw.set(false)
    expect(life.running).toBe(false)
    expect(made[0]?.log).toEqual(['remove'])

    sw.set(true)
    expect(life.running).toBe(true)
    expect(made).toHaveLength(2)
  })

  test('a repeated value starts or removes nothing twice', async () => {
    const sw = fakeSwitch(true)
    let started = 0
    const life = runWhileEnabled({
      enabled: sw.enabled,
      start: () => {
        started++
        return fakeContent().content
      },
    })
    sw.answer()
    await tick()
    sw.set(true)
    sw.set(true)
    expect(started).toBe(1)
    sw.set(false)
    sw.set(false)
    expect(life.running).toBe(false)
  })

  test('a change that arrives before the first read answers wins over it', async () => {
    const sw = fakeSwitch(true)
    let started = 0
    const life = runWhileEnabled({
      enabled: sw.enabled,
      start: () => {
        started++
        return fakeContent().content
      },
    })
    sw.set(false)
    sw.answer()
    await tick()
    expect(started).toBe(0)
    expect(life.running).toBe(false)
  })

  test('starts when the preferences cannot be read: on is the default', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {})
    const sw = fakeSwitch(new Error('storage is gone'))
    const life = runWhileEnabled({
      enabled: sw.enabled,
      start: () => fakeContent().content,
    })
    sw.answer()
    await tick()
    log.mockRestore()
    expect(life.running).toBe(true)
  })

  test('a page that is not Audible never counts as running', async () => {
    const sw = fakeSwitch(true)
    const life = runWhileEnabled({
      enabled: sw.enabled,
      start: () => undefined,
    })
    sw.answer()
    await tick()
    expect(life.running).toBe(false)
  })

  test('stop leaves the page as it is and ignores later changes', async () => {
    const sw = fakeSwitch(true)
    const c = fakeContent()
    let started = 0
    const life = runWhileEnabled({
      enabled: sw.enabled,
      start: () => {
        started++
        return c.content
      },
    })
    sw.answer()
    await tick()
    life.stop()
    expect(c.log).toEqual(['stop'])
    expect(sw.watchers).toBe(0)
    sw.set(false)
    sw.set(true)
    expect(started).toBe(1)
    expect(c.log).toEqual(['stop'])
  })

  test('does not start when stopped before the first read answered', async () => {
    const sw = fakeSwitch(true)
    let started = 0
    const life = runWhileEnabled({
      enabled: sw.enabled,
      start: () => {
        started++
        return undefined
      },
    })
    life.stop()
    sw.answer()
    await tick()
    expect(started).toBe(0)
  })
})

describe('turning the extension off on a real page', () => {
  const A = 'B000000001'
  const page = `<main><div data-card="${A}">
    <a href="/pd/Title/${A}"><img alt="Title cover art"></a>
    <h3><a href="/pd/Title/${A}">Title</a></h3></div></main>`

  test('removes the badges, the overview and the stylesheet, and closes the port', () => {
    loadBody(page)
    const world = startWorld()
    world.io.intersect()
    world.port.receive(
      ready(A, { r: 4, n: 10 }, { genres: [], year: 0, desc: 'Text' })
    )
    ;(mainBadges()[0] as Element).dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true })
    )
    expect(document.querySelector('.agx-overview-host')).not.toBeNull()

    world.content?.remove()

    expect(document.querySelector('.agx-wrap, .agx-badge')).toBeNull()
    expect(document.querySelector('.agx-overview-host')).toBeNull()
    expect(document.getElementById('agx-style')).toBeNull()
    expect(world.port.closed).toBe(true)
  })

  test('starting again puts the badge back from the same page', () => {
    loadBody(page)
    const first = startWorld()
    first.io.intersect()
    first.content?.remove()

    const second = startWorld()
    second.io.intersect()
    expect(mainBadges()).toHaveLength(1)
    expect(document.getElementById('agx-style')).not.toBeNull()
    expect(second.port.lookups()).toEqual([[A]])
  })
})
