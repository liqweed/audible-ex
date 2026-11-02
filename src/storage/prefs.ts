/**
 * The user's preferences: one item, `sync:prefs`, in `storage.sync`, so they follow the user across
 * devices and Audible marketplaces (ARCHITECTURE.md §8). Every reader (content scripts, popup,
 * options) watches it, so a change in one place applies everywhere at once.
 *
 * Only `enabled` exists so far; the filters and display options join it in phase 3, each with a
 * default here, so a record written by an older version still decodes. Change the shape → bump
 * `version` and add a migration.
 */
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { storage } from 'wxt/utils/storage'

/** Prefs v1. A key missing from the stored record takes its default. */
export const Prefs = Schema.Struct({
  /** The extension's master switch: off removes the badges and stops the lookups. */
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true))
  ),
})
export type Prefs = typeof Prefs.Type

export const DEFAULT_PREFS: Prefs = { enabled: true }

const decode = Schema.decodeUnknownOption(Prefs)

/**
 * The prefs a stored value stands for. A value that is not a record of prefs (damaged, or written
 * by a newer version) gives the defaults rather than an error: the UI must always have prefs.
 */
export function decodePrefs(raw: unknown): Prefs {
  return Option.getOrElse(decode(raw), () => DEFAULT_PREFS)
}

const item = storage.defineItem<unknown>('sync:prefs', {
  fallback: DEFAULT_PREFS,
  version: 1,
})

export const readPrefs = async (): Promise<Prefs> =>
  decodePrefs(await item.getValue())

/** Changes some prefs and keeps the rest as they are. */
export async function updatePrefs(change: Partial<Prefs>): Promise<void> {
  await item.setValue({ ...(await readPrefs()), ...change })
}

/** Calls `listener` with the new prefs after each change; returns the function that stops it. */
export const watchPrefs = (listener: (prefs: Prefs) => void): (() => void) =>
  item.watch(value => listener(decodePrefs(value)))
