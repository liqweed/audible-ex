/**
 * What the popup asks of the background worker (ARCHITECTURE.md §5), behind a small interface so
 * the popup's tests need no browser. Replies are decoded; a reply that is missing (the worker did
 * not answer) or that says `Failed` becomes an error the popup shows.
 */
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { browser } from 'wxt/browser'
import {
  type ClearScope,
  PopupReply,
  type PopupRequest,
  type Stats,
} from '@/schema/popup'

export interface Backend {
  stats(): Promise<Stats>
  /** Empties the cache; returns how many entries were deleted. */
  clear(scope: ClearScope): Promise<number>
}

const decodeReply = Schema.decodeUnknownOption(PopupReply)

async function send(request: PopupRequest): Promise<PopupReply> {
  const reply = decodeReply(await browser.runtime.sendMessage(request))
  if (Option.isNone(reply)) throw new Error('The background did not answer')
  if (reply.value._tag === 'Failed') throw new Error(reply.value.message)
  return reply.value
}

export const extensionBackend: Backend = {
  async stats() {
    const reply = await send({ _tag: 'CacheStats' })
    if (reply._tag !== 'Stats') throw new Error('Unexpected reply')
    return reply
  },
  async clear(scope) {
    const reply = await send({ _tag: 'ClearCache', scope })
    if (reply._tag !== 'Cleared') throw new Error('Unexpected reply')
    return reply.deleted
  },
}
