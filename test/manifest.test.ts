import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REGIONS } from '../src/core/regions'
import config from '../wxt.config'

// ARCHITECTURE.md §11 and the privacy statement list the permissions the extension asks for. This
// test holds the manifest to them, so a permission cannot be added without the document changing too.

const manifest = config.manifest as {
  permissions: string[]
  host_permissions: string[]
}
const architecture = readFileSync(
  join(import.meta.dir, '../docs/ARCHITECTURE.md'),
  'utf8'
)

describe('manifest permissions', () => {
  test('are storage and unlimitedStorage, and nothing broader', () => {
    expect(manifest.permissions).toEqual(['storage', 'unlimitedStorage'])
  })

  test('host permissions are Goodreads and the ten Audible API hosts', () => {
    expect([...manifest.host_permissions].sort()).toEqual(
      [
        'https://www.goodreads.com/*',
        ...REGIONS.map(r => `https://${r.apiHost}/*`),
      ].sort()
    )
    expect(manifest.host_permissions).toHaveLength(11)
  })

  test('ARCHITECTURE.md §11 names each of them', () => {
    const section = architecture.slice(
      architecture.indexOf('## 11. Manifest, permissions, privacy'),
      architecture.indexOf('## 12.')
    )
    for (const permission of manifest.permissions) {
      expect(section).toContain(`\`${permission}\``)
    }
    expect(section).toContain('https://www.goodreads.com/*')
    expect(section).toContain('https://api.audible.<tld>/*')
    expect(section).toContain('10')
  })
})
