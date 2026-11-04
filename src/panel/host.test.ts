import { describe, expect, test } from 'bun:test'
import { createStore } from '@tanstack/store'
import { createBookStore } from '@/content/books'
import type { FilterState } from '@/content/filter'
import type { PanelHandle } from '@/content/shared'
import { type MountedPanel, runPanel } from './host'

const handle = (): PanelHandle => ({
  state: createBookStore().state,
  filter: createStore<FilterState>({
    hidden: 0,
    dimmed: 0,
    highlighted: 0,
    peek: false,
  }),
  retryFailed: () => {},
  setPeek: () => {},
})

/** A watcher the test drives, and a mount it can finish by hand. */
function setup() {
  let listener: (h: PanelHandle | undefined) => void = () => {}
  const mounts: Array<{
    handle: PanelHandle
    finish: () => void
    fail: (e: unknown) => void
    removed: number
  }> = []
  const errors: unknown[] = []
  const stop = runPanel({
    watch: l => {
      listener = l
      return () => {}
    },
    mount: h =>
      new Promise<MountedPanel>((resolve, reject) => {
        const entry = {
          handle: h,
          removed: 0,
          finish: () => resolve({ remove: () => entry.removed++ }),
          fail: reject,
        }
        mounts.push(entry)
      }),
    onError: e => errors.push(e),
  })
  return {
    say: (h: PanelHandle | undefined) => listener(h),
    mounts,
    errors,
    stop,
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('runPanel', () => {
  test('mounts when a handle appears, and removes the panel when it goes', async () => {
    const t = setup()
    const h = handle()
    t.say(undefined)
    expect(t.mounts).toHaveLength(0)
    t.say(h)
    t.mounts[0]?.finish()
    await tick()
    expect(t.mounts[0]?.removed).toBe(0)
    t.say(undefined)
    expect(t.mounts[0]?.removed).toBe(1)
  })

  test('the same handle again mounts nothing new', async () => {
    const t = setup()
    const h = handle()
    t.say(h)
    t.say(h)
    expect(t.mounts).toHaveLength(1)
  })

  test('a new handle replaces the panel (the extension was switched off and on)', async () => {
    const t = setup()
    t.say(handle())
    t.mounts[0]?.finish()
    await tick()
    t.say(handle())
    expect(t.mounts[0]?.removed).toBe(1)
    expect(t.mounts).toHaveLength(2)
  })

  test('a handle withdrawn while the panel is still being built removes it when done', async () => {
    const t = setup()
    t.say(handle())
    t.say(undefined)
    t.mounts[0]?.finish()
    await tick()
    expect(t.mounts[0]?.removed).toBe(1)
  })

  test('a handle replaced while the first panel is being built keeps only the second', async () => {
    const t = setup()
    t.say(handle())
    t.say(handle())
    t.mounts[0]?.finish()
    t.mounts[1]?.finish()
    await tick()
    expect(t.mounts[0]?.removed).toBe(1)
    expect(t.mounts[1]?.removed).toBe(0)
  })

  test('reports a mount that fails, and tries again for the next handle', async () => {
    const t = setup()
    const boom = new Error('boom')
    t.say(handle())
    t.mounts[0]?.fail(boom)
    await tick()
    expect(t.errors).toEqual([boom])
    t.say(handle())
    expect(t.mounts).toHaveLength(2)
  })

  test('stopping removes the panel and ignores a mount that finishes later', async () => {
    const t = setup()
    t.say(handle())
    t.mounts[0]?.finish()
    await tick()
    t.stop()
    expect(t.mounts[0]?.removed).toBe(1)
    const u = setup()
    u.say(handle())
    u.stop()
    u.mounts[0]?.finish()
    await tick()
    expect(u.mounts[0]?.removed).toBe(1)
  })
})
