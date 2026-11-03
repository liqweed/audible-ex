import { describe, expect, test } from 'bun:test'
import { serial } from './serial'

describe('serial', () => {
  test('runs jobs one at a time, in order', async () => {
    const queue = serial()
    const log: string[] = []
    const job = (name: string, ms: number) => async () => {
      log.push(`start ${name}`)
      await Bun.sleep(ms)
      log.push(`end ${name}`)
      return name
    }
    const results = await Promise.all([
      queue(job('a', 15)),
      queue(job('b', 1)),
      queue(job('c', 1)),
    ])
    expect(results).toEqual(['a', 'b', 'c'])
    expect(log).toEqual([
      'start a',
      'end a',
      'start b',
      'end b',
      'start c',
      'end c',
    ])
  })

  test('a failed job rejects its caller and lets the next one run', async () => {
    const queue = serial()
    const failing = queue(async () => {
      throw new Error('storage is full')
    })
    const next = queue(async () => 'ran')
    await expect(failing).rejects.toThrow('storage is full')
    expect(await next).toBe('ran')
  })
})
