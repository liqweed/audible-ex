import { describe, expect, mock, test } from 'bun:test'
import type { OpenOptionsReply } from '../schema/panel'
import { handleOpenOptions } from './options'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('handleOpenOptions', () => {
  test('opens the options page and says so', async () => {
    const open = mock(() => Promise.resolve())
    const replies: OpenOptionsReply[] = []
    expect(
      handleOpenOptions({ _tag: 'OpenOptions' }, open, r => replies.push(r))
    ).toBe(true)
    await flush()
    expect(open).toHaveBeenCalledTimes(1)
    expect(replies).toEqual([{ _tag: 'Opened' }])
  })

  test('reports a page that could not be opened', async () => {
    const replies: OpenOptionsReply[] = []
    const error = console.error
    console.error = () => {}
    try {
      handleOpenOptions(
        { _tag: 'OpenOptions' },
        () => Promise.reject(new Error('no window')),
        r => replies.push(r)
      )
      await flush()
    } finally {
      console.error = error
    }
    expect(replies).toEqual([{ _tag: 'Failed', message: 'no window' }])
  })

  test.each([
    { _tag: 'CacheStats' },
    { _tag: 'ClearCache', scope: 'all' },
    'OpenOptions',
    null,
  ])('leaves %j to the other listeners', message => {
    const open = mock(() => Promise.resolve())
    expect(handleOpenOptions(message, open, () => {})).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
