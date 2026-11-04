/**
 * The panel's one-off request to the background (`runtime.sendMessage`, ARCHITECTURE.md §5): open
 * the options page. A content script cannot open it itself (`runtime.openOptionsPage` is not
 * available there, and a link to the page would need it to be web-accessible).
 */
import * as Schema from 'effect/Schema'

export const OpenOptionsRequest = Schema.TaggedStruct('OpenOptions', {})

export const Opened = Schema.TaggedStruct('Opened', {})
export const OpenFailed = Schema.TaggedStruct('Failed', {
  message: Schema.String,
})

export const OpenOptionsReply = Schema.Union([Opened, OpenFailed])
export type OpenOptionsReply = typeof OpenOptionsReply.Type
