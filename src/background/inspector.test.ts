import { expect, test } from 'bun:test'
import { decodeInspectorRequest, handleInspectorMessage } from './inspector'

test('inspector requests validate identifiers before accessing the cache', () => {
  expect(
    decodeInspectorRequest({ _tag: 'DeleteCachedBook', asin: 'invalid' })._tag
  ).toBe('None')
  expect(
    decodeInspectorRequest({
      _tag: 'CorrectCachedBook',
      asin: 'B08G9PRS1K',
      url: 1,
    })._tag
  ).toBe('None')
  expect(decodeInspectorRequest({ _tag: 'ListCachedBooks' })._tag).toBe('Some')
})
test('web pages and other extensions cannot read or mutate cached books', () => {
  let called = false
  const run = async () => {
    called = true
    return { _tag: 'CacheChanged' } as const
  }
  for (const url of [
    'https://www.audible.com/search',
    'chrome-extension://other/options.html',
    undefined,
  ]) {
    for (const request of [
      { _tag: 'ListCachedBooks' },
      { _tag: 'DeleteCachedBook', asin: 'B08G9PRS1K' },
      {
        _tag: 'CorrectCachedBook',
        asin: 'B08G9PRS1K',
        url: 'https://www.goodreads.com/book/show/1',
      },
    ]) {
      expect(
        handleInspectorMessage(
          run,
          request,
          { url },
          'chrome-extension://self/',
          () => {}
        )
      ).toBe(false)
    }
  }
  expect(called).toBe(false)
})
test('an options page in a tab receives a reply or a startup failure', async () => {
  let response: unknown
  expect(
    handleInspectorMessage(
      async () => {
        throw new Error('blocked')
      },
      { _tag: 'ListCachedBooks' },
      { url: 'chrome-extension://self/options.html' },
      'chrome-extension://self/',
      reply => {
        response = reply
      }
    )
  ).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(response).toEqual({ _tag: 'Failed', message: 'blocked' })
})
