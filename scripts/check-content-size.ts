#!/usr/bin/env bun
/**
 * Fails when the built content script is larger than its budget. The content script runs on every
 * Audible page, so an accidental import of the `effect` barrel or of a heavy library must show up
 * in the pull request that adds it (ARCHITECTURE.md §6). Measured when the budget was set: one named
 * import from the barrel adds about 17 KB gzipped, a namespace import about 235 KB; both fail.
 * Run after `bun run build`:
 *
 *   bun scripts/check-content-size.ts [path/to/content.js]
 *
 * The budget is gzipped bytes of the Chrome build's `content-scripts/content.js`. It was set from
 * the first real build (36 KB with badges, overview, popup switch and prefs) with room to grow;
 * raise it in the pull request that needs the room (the floating panel, phase 2), and say why.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

export const BUDGET_BYTES = 50 * 1024

const DEFAULT_PATH = join(
  import.meta.dir,
  '../.output/chrome-mv3/content-scripts/content.js'
)

export interface SizeCheck {
  readonly ok: boolean
  readonly message: string
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

/** Judges a gzipped size against the budget; the message is what CI prints. */
export function checkSize(gzipped: number, budget = BUDGET_BYTES): SizeCheck {
  const line = `content script: ${kb(gzipped)} gzipped, budget ${kb(budget)}`
  return gzipped <= budget
    ? { ok: true, message: line }
    : {
        ok: false,
        message: `${line}. It is ${kb(gzipped - budget)} over: look for an import that pulls in a library (the \`effect\` barrel, React) and import by path instead, or raise BUDGET_BYTES in scripts/check-content-size.ts and say why.`,
      }
}

if (import.meta.main) {
  const path = process.argv[2] ?? DEFAULT_PATH
  let source: Buffer
  try {
    source = readFileSync(path)
  } catch {
    console.error(`Cannot read ${path}: run \`bun run build\` first.`)
    process.exit(2)
  }
  const result = checkSize(gzipSync(source, { level: 9 }).length)
  console.log(result.message)
  process.exit(result.ok ? 0 : 1)
}
