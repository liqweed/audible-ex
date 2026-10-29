import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// src/core is shared by the content script, the background worker and wxt.config.ts, so it must
// stay free of Effect, Node and any browser or DOM API (ARCHITECTURE.md §4). `bun test` registers
// happy-dom and a fake `browser` globally (test/preload.ts), so a module that reached for them would
// pass its own tests; this test reads the sources instead.

const DIR = import.meta.dir
const modules = readdirSync(DIR).filter(
  name => name.endsWith('.ts') && !name.endsWith('.test.ts')
)

/** The source without comments, so a doc comment can say "no DOM" without tripping the check. */
const code = (name: string) =>
  readFileSync(join(DIR, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Every module specifier the file imports or requires. */
const specifiers = (source: string) =>
  [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
  ].map(m => m[1] as string)

describe('src/core stays pure', () => {
  test('has the modules this test is meant to guard', () => {
    for (const name of ['asin.ts', 'matching.ts', 'regions.ts', 'text.ts']) {
      expect(modules).toContain(name)
    }
  })

  test.each(modules)('%s imports only other src/core modules', name => {
    for (const specifier of specifiers(code(name))) {
      expect(specifier, `${name} imports ${specifier}`).toMatch(
        /^(\.\/[\w-]+|@\/core\/[\w-]+)$/
      )
    }
  })

  test.each(modules)('%s names no browser, DOM or Node global', name => {
    expect(code(name)).not.toMatch(
      /\b(chrome|browser|document|window|globalThis|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|process|Buffer|Bun)\b/
    )
  })

  test('the checks catch what they are meant to', () => {
    expect(specifiers(`import * as S from 'effect/Schema'`)).toEqual([
      'effect/Schema',
    ])
    expect(specifiers(`import { readFileSync } from 'node:fs'`)).toEqual([
      'node:fs',
    ])
    expect(specifiers(`const m = await import('wxt/browser')`)).toEqual([
      'wxt/browser',
    ])
    expect(specifiers(`import './side-effect'`)).toEqual(['./side-effect'])
  })
})
