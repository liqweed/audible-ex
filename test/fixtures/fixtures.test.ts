import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { findPersonalData } from '../../scripts/fixture-scrub'

// Guards the committed fixtures, not the code that uses them: what they must never contain, and
// that README.md documents every one. The tests that use the fixtures are in phase 1.
const ROOT = import.meta.dir
const fixtures = (readdirSync(ROOT, { recursive: true }) as string[])
  .filter(path => /^(audible|goodreads)\/.+\.(html|json)$/.test(path))
  .sort()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const readme = read('README.md')

describe('fixtures', () => {
  test('exist', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  test.each(fixtures)('%s holds no personal data', path => {
    expect(findPersonalData(read(path))).toEqual([])
  })

  test.each(fixtures.filter(p => p.startsWith('goodreads/book/')))(
    '%s holds no session or reviewer data',
    path => {
      expect(read(path)).not.toMatch(
        /"jwtToken"|"apiKey"|"authContextParams"|"userAgent"|"User:\d+"|"__typename": "(User|Review|Shelving)"|goodreads\.com\/notes\//
      )
    }
  )

  test.each(fixtures)('%s is documented in README.md', path => {
    // Audible pages are listed as `audible/{uk,com}/<page>.html`; Goodreads files by their book's
    // slug (`<slug>.title.json`, `<id>-<slug>.html`).
    const name = basename(path)
    const listed = path.startsWith('audible/')
      ? `audible/{uk,com}/${name}`
      : `\`${name.match(/^(?:\d+-)?([^.]+?)(?:\.|$)/)?.[1]}\``
    expect(readme).toContain(listed)
  })
})
