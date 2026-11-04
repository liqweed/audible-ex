import * as Schema from 'effect/Schema'
import { browser } from 'wxt/browser'
import {
  type CachedBook,
  InspectorReply,
  type InspectorRequest,
} from '@/schema/inspector'

export interface CacheBackend {
  list(): Promise<readonly CachedBook[]>
  deleteBook(asin: string): Promise<void>
  correct(asin: string, url: string): Promise<void>
}
async function send(request: InspectorRequest) {
  const reply = Schema.decodeUnknownSync(InspectorReply)(
    await browser.runtime.sendMessage(request)
  )
  if (reply._tag === 'Failed') throw new Error(reply.message)
  return reply
}
export const cacheBackend: CacheBackend = {
  async list() {
    const reply = await send({ _tag: 'ListCachedBooks' })
    if (reply._tag !== 'CachedBooks')
      throw new Error('Unexpected background reply')
    return reply.books
  },
  async deleteBook(asin) {
    const reply = await send({ _tag: 'DeleteCachedBook', asin })
    if (reply._tag !== 'CacheChanged')
      throw new Error('Unexpected background reply')
  },
  async correct(asin, url) {
    const reply = await send({ _tag: 'CorrectCachedBook', asin, url })
    if (reply._tag !== 'CacheChanged')
      throw new Error('Unexpected background reply')
  },
}
