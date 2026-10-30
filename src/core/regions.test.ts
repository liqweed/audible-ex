import { describe, expect, test } from 'bun:test'
import {
  apiHostPermissions,
  contentScriptMatches,
  REGIONS,
  regionByCode,
  regionFromHost,
} from '@/core/regions'

// Every marketplace the userscript supports (its @match list), with what the table must say about it.
const MARKETPLACES = [
  { tld: 'com', code: 'US', currency: 'USD', locale: 'en-US' },
  { tld: 'co.uk', code: 'UK', currency: 'GBP', locale: 'en-GB' },
  { tld: 'ca', code: 'CA', currency: 'CAD', locale: 'en-CA' },
  { tld: 'com.au', code: 'AU', currency: 'AUD', locale: 'en-AU' },
  { tld: 'in', code: 'IN', currency: 'INR', locale: 'en-IN' },
  { tld: 'de', code: 'DE', currency: 'EUR', locale: 'de-DE' },
  { tld: 'fr', code: 'FR', currency: 'EUR', locale: 'fr-FR' },
  { tld: 'it', code: 'IT', currency: 'EUR', locale: 'it-IT' },
  { tld: 'es', code: 'ES', currency: 'EUR', locale: 'es-ES' },
  { tld: 'co.jp', code: 'JP', currency: 'JPY', locale: 'ja-JP' },
] as const

describe('REGIONS', () => {
  test('has exactly the ten marketplaces, each once', () => {
    expect(REGIONS.map(r => r.tld).sort()).toEqual(
      MARKETPLACES.map(m => m.tld).sort()
    )
    expect(new Set(REGIONS.map(r => r.code)).size).toBe(REGIONS.length)
  })
})

describe('regionFromHost', () => {
  for (const m of MARKETPLACES) {
    test(`www.audible.${m.tld} is ${m.code}`, () => {
      expect(regionFromHost(`www.audible.${m.tld}`)).toEqual({
        code: m.code,
        tld: m.tld,
        siteHost: `www.audible.${m.tld}`,
        apiHost: `api.audible.${m.tld}`,
        currency: m.currency,
        locale: m.locale,
      })
    })

    test(`audible.${m.tld} (no www.) is ${m.code}`, () => {
      expect(regionFromHost(`audible.${m.tld}`)?.code).toBe(m.code)
    })
  }

  test('ignores letter case', () => {
    expect(regionFromHost('WWW.Audible.Co.UK')?.code).toBe('UK')
  })

  test('returns undefined for hosts that are not an Audible marketplace', () => {
    for (const host of [
      'example.com',
      'notaudible.com',
      'audible.com.evil.example',
      'www.audible.com.evil.example',
      'evil.example/www.audible.com',
      'audible.nl',
      'api.audible.com',
      'www.www.audible.com',
      'www.goodreads.com',
      '',
    ]) {
      expect(regionFromHost(host)).toBeUndefined()
    }
  })
})

describe('regionByCode', () => {
  test('finds each marketplace by its code', () => {
    for (const m of MARKETPLACES) {
      expect(regionByCode(m.code).apiHost).toBe(`api.audible.${m.tld}`)
    }
  })
})

describe('contentScriptMatches', () => {
  test('one https www. pattern per marketplace', () => {
    expect(contentScriptMatches().sort()).toEqual(
      MARKETPLACES.map(m => `https://www.audible.${m.tld}/*`).sort()
    )
  })
})

describe('apiHostPermissions', () => {
  test('one https api. pattern per marketplace', () => {
    expect(apiHostPermissions().sort()).toEqual(
      MARKETPLACES.map(m => `https://api.audible.${m.tld}/*`).sort()
    )
  })
})
