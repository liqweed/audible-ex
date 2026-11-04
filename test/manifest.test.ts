import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REGIONS } from '../src/core/regions'
import config from '../wxt.config'

// ARCHITECTURE.md §11 and the privacy statement list the permissions the extension asks for. This
// test holds the manifest to them, so a permission cannot be added without the document changing too.

interface Manifest {
  permissions: string[]
  host_permissions: string[]
  browser_specific_settings?: {
    gecko?: {
      id?: string
      strict_min_version?: string
      data_collection_permissions?: { required: string[] }
    }
  }
}

/** The manifest the config gives for `browser`, as WXT asks for it. */
const manifestFor = async (browser: 'chrome' | 'firefox') => {
  const make = config.manifest as (env: {
    browser: string
    manifestVersion: 2 | 3
    mode: string
    command: 'build'
  }) => Manifest | Promise<Manifest>
  return make({
    browser,
    manifestVersion: browser === 'firefox' ? 2 : 3,
    mode: 'production',
    command: 'build',
  })
}
const manifest = await manifestFor('chrome')
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

describe('the Firefox manifest', () => {
  test('asks for the same permissions as Chrome', async () => {
    const firefox = await manifestFor('firefox')
    expect(firefox.permissions).toEqual(manifest.permissions)
    expect(firefox.host_permissions).toEqual(manifest.host_permissions)
  })

  test('has the add-on ID and declares what it sends, as PRIVACY.md does', async () => {
    const gecko = (await manifestFor('firefox')).browser_specific_settings
      ?.gecko
    expect(gecko?.id).toBe('audible-ex@liqweed.github.io')
    expect(gecko?.strict_min_version).toBe('140.0')
    expect(gecko?.data_collection_permissions).toEqual({
      required: ['websiteContent'],
    })
    const privacy = readFileSync(join(import.meta.dir, '../PRIVACY.md'), 'utf8')
    expect(privacy).toContain('"website content"')
  })

  test('Chrome gets none of the Firefox settings', () => {
    expect(manifest.browser_specific_settings).toBeUndefined()
  })
})
