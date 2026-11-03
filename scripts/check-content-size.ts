#!/usr/bin/env bun
/**
 * Fails when the built content script is larger than its budget. The content script runs on every
 * Audible page, so an accidental import of the `effect` barrel or of a heavy library must show up
 * in the pull request that adds it (ARCHITECTURE.md §6). Measured when the budget was set: one named
 * import from the barrel adds about 17 KB gzipped, a namespace import about 235 KB; both fail.
 * The floating panel is a second content script, `panel.js` (DECISIONS.md D19), with a budget of its
 * own: React lives there, never in `content.js`. Run after `bun run build`:
 *
 *   bun scripts/check-content-size.ts [path/to/content.js] [path/to/panel.js]
 *
 * With no path it checks both files of the Chrome build. A path is judged by its name: `panel.js`
 * against the panel budget, anything else against the content budget.
 *
 * The content budget is gzipped bytes of `content-scripts/content.js`. It was set from the first
 * real build (36 KB with badges, overview, popup switch and prefs) with room to grow. The panel
 * budget was set from the first panel build (64 KB: React and the progress view, before the Radix
 * controls of the filters, which add about 12 KB). The shell's stored state brought `effect/Schema`
 * into the panel (92 KB). The filter controls (Radix switch and slider, Pacer's debouncer, the
 * label picker) brought it to 104.7 KB, so the budget is now 120 KB; the options page (phase 4) is
 * its own entrypoint and does not count against it. Raise either in the pull request that needs the room,
 * and say why.
 */
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { gzipSync } from 'node:zlib'

export const BUDGET_BYTES = 50 * 1024
export const PANEL_BUDGET_BYTES = 120 * 1024

const SCRIPTS = join(import.meta.dir, '../.output/chrome-mv3/content-scripts')
const DEFAULT_PATHS = [join(SCRIPTS, 'content.js'), join(SCRIPTS, 'panel.js')]

export interface SizeCheck {
  readonly ok: boolean
  readonly message: string
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

/** Judges a gzipped size against a budget; the message is what CI prints. */
export function checkSize(
  gzipped: number,
  budget = BUDGET_BYTES,
  name = 'content script'
): SizeCheck {
  const line = `${name}: ${kb(gzipped)} gzipped, budget ${kb(budget)}`
  const advice =
    budget === PANEL_BUDGET_BYTES
      ? 'look for an import that pulls in a library the panel does not need, or raise PANEL_BUDGET_BYTES in scripts/check-content-size.ts and say why.'
      : 'look for an import that pulls in a library (the `effect` barrel, React) and import by path instead, or raise BUDGET_BYTES in scripts/check-content-size.ts and say why.'
  return gzipped <= budget
    ? { ok: true, message: line }
    : {
        ok: false,
        message: `${line}. It is ${kb(gzipped - budget)} over: ${advice}`,
      }
}

if (import.meta.main) {
  const paths = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PATHS
  let failed = false
  for (const path of paths) {
    let source: Buffer
    try {
      source = readFileSync(path)
    } catch {
      console.error(`Cannot read ${path}: run \`bun run build\` first.`)
      process.exit(2)
    }
    const panel = basename(path) === 'panel.js'
    const result = checkSize(
      gzipSync(source, { level: 9 }).length,
      panel ? PANEL_BUDGET_BYTES : BUDGET_BYTES,
      panel ? 'panel script' : 'content script'
    )
    console.log(result.message)
    if (!result.ok) failed = true
  }
  process.exit(failed ? 1 : 0)
}
