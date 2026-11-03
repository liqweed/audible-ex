/**
 * Where the floating panel sits and whether it is open: one item, `local:panel`, in `storage.local`
 * (ARCHITECTURE.md §8). It belongs to this screen and device, so unlike the prefs it does not sync.
 * The panel reads and writes it; the popup watches it to offer the panel back after "hide on this
 * site". Change the shape → bump `version` and add a migration.
 */
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { storage } from 'wxt/utils/storage'
import { serial } from './serial'

export const CORNERS = [
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
] as const
export type Corner = (typeof CORNERS)[number]

/** Panel state v1. A key missing from the stored record takes its default. */
export const PanelState = Schema.Struct({
  /** The viewport corner the panel is docked to. */
  corner: Schema.Literals(CORNERS).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<Corner>('bottomRight'))
  ),
  /** Shown as a small pill (`34/60`) instead of the full panel. */
  collapsed: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false))
  ),
  /** Host names (`www.audible.co.uk`) where the user hid the panel. */
  hiddenHosts: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<readonly string[]>([]))
  ),
})
export type PanelState = typeof PanelState.Type

export const DEFAULT_PANEL: PanelState = {
  corner: 'bottomRight',
  collapsed: false,
  hiddenHosts: [],
}

const decode = Schema.decodeUnknownOption(PanelState)

/** The state a stored value stands for; a value that is not a record of it gives the defaults. */
export function decodePanel(raw: unknown): PanelState {
  return Option.getOrElse(decode(raw), () => DEFAULT_PANEL)
}

const item = storage.defineItem<unknown>('local:panel', {
  fallback: DEFAULT_PANEL,
  version: 1,
})

const queue = serial()

export const readPanel = async (): Promise<PanelState> =>
  decodePanel(await item.getValue())

/**
 * Changes some of the state and keeps the rest. A function gets the stored state as it is when the
 * write begins, not the state its caller last saw, so a site hidden in another tab is kept. Updates
 * in one script run one after another (`serial`); storage has no transactions, so two tabs writing
 * within the same few milliseconds can still lose one.
 */
export const updatePanel = (
  change: Partial<PanelState> | ((current: PanelState) => Partial<PanelState>)
): Promise<void> =>
  queue(async () => {
    const current = await readPanel()
    const patch = typeof change === 'function' ? change(current) : change
    await item.setValue({ ...current, ...patch })
  })

/** Calls `listener` with the new state after each change; returns the function that stops it. */
export const watchPanel = (
  listener: (state: PanelState) => void
): (() => void) => item.watch(value => listener(decodePanel(value)))

/** What the panel needs of storage; tests pass an in-memory one. */
export interface PanelStorage {
  read: typeof readPanel
  update: typeof updatePanel
  watch: typeof watchPanel
}

export const panelStorage: PanelStorage = {
  read: readPanel,
  update: updatePanel,
  watch: watchPanel,
}
