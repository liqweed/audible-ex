/**
 * Opens the options page for the panel's settings button (ARCHITECTURE.md §5). Unlike the popup's
 * cache requests it is answered for a content script too: opening the extension's own page is all
 * it can do, and only this extension's scripts can send to `runtime.onMessage` (the manifest has no
 * `externally_connectable`).
 */
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { type OpenOptionsReply, OpenOptionsRequest } from '../schema/panel'

const decode = Schema.decodeUnknownOption(OpenOptionsRequest)

/**
 * The `runtime.onMessage` listener's body: true when the message was `OpenOptions` and will be
 * answered through `respond`, false when it is not for this handler.
 */
export function handleOpenOptions(
  message: unknown,
  open: () => Promise<void>,
  respond: (reply: OpenOptionsReply) => void
): boolean {
  if (Option.isNone(decode(message))) return false
  open().then(
    () => respond({ _tag: 'Opened' }),
    error => {
      console.error('audible-ex: could not open the options page', error)
      respond({
        _tag: 'Failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  )
  return true
}
