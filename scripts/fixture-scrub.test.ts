import { describe, expect, test } from 'bun:test'
import {
  dropVolatileParams,
  extractBookFixture,
  findPersonalData,
  normaliseAutocomplete,
  redactStrings,
  scrubAudibleHtml,
} from './fixture-scrub'

describe('dropVolatileParams', () => {
  test('drops per-request parameters, keeps the stable ones', () => {
    expect(
      dropVolatileParams(
        '/cat/X/1?ref_pageloadid=a&amp;pf_rd_r=B&amp;pageLoadId=c&amp;ref=a_hp_i2#top'
      )
    ).toBe('/cat/X/1?ref=a_hp_i2#top')
  })

  test('drops the query when nothing is left, and encoded blobs', () => {
    expect(dropVolatileParams('/x?plink=abc&creativeId=1')).toBe('/x')
    expect(dropVolatileParams(`/x?id=${'A'.repeat(80)}&asin=B0ABC`)).toBe(
      '/x?asin=B0ABC'
    )
  })

  test('leaves a URL without a query alone', () => {
    expect(dropVolatileParams('/pd/Title/B000000000')).toBe(
      '/pd/Title/B000000000'
    )
  })
})

describe('scrubAudibleHtml', () => {
  const page = `<!doctype html>
<html><head><title>Audible</title>
<meta name="csrf-token" content="secret">
<link rel="stylesheet" href="/x.css">
<script>window.customerId = "A1B2C3D4E5F6G7"</script>
<style>.a { color: red }</style>
</head><body>
<!-- request O-2fdb528e4c1f2975bbdb0e69c92a0c5a -->
<svg><path d="M0"/></svg>
<img src='//fls-na.amazon.com/1/batch/1/OP/A2I9A3Q2GNFNGQ:525-8621033-0589662:8J7ZZW9ZDPXX$u' />
<input type="hidden" name="csrfToken" value="abc123">
<input type="text" name="q" value="andy weir">
<ul><li class="productListItem">
  <a href="/pd/Project-Hail-Mary/B08G9PRS1K?pf_rd_p=guid&amp;ref=a_search_c4_1">Project Hail Mary</a>
</li></ul>
<div data-csrf-token="zzz" nonce="n1">Contact audible-search-de@amazon.com</div>
</body></html>`
  const out = scrubAudibleHtml(page)

  test('keeps what card detection reads', () => {
    expect(out).toContain('<li class="productListItem">')
    expect(out).toContain(
      '<a href="/pd/Project-Hail-Mary/B08G9PRS1K?ref=a_search_c4_1">'
    )
    expect(out).toContain('<title>Audible</title>')
    expect(out).toContain('<input type="text" name="q" value="andy weir">')
  })

  test('removes scripts, styles, svg, comments, meta, link and logging pixels', () => {
    for (const gone of [
      '<script',
      '<style',
      '<svg',
      '<!--',
      '<meta',
      '<link',
      'fls-na',
    ]) {
      expect(out).not.toContain(gone)
    }
  })

  test('removes hidden values, token attributes and email addresses', () => {
    expect(out).toContain('name="csrfToken" value=""')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('data-csrf-token')
    expect(out).not.toContain('nonce=')
    expect(out).not.toContain('amazon.com')
    expect(out).toContain('redacted@example.invalid')
  })

  test('leaves nothing findPersonalData would flag, and is idempotent', () => {
    expect(findPersonalData(out)).toEqual([])
    expect(scrubAudibleHtml(out)).toBe(out)
  })

  test('is stable: markup differing only in volatile bits scrubs identically', () => {
    const again = page
      .replace('guid', 'another-guid')
      .replace('525-8621033-0589662', '111-2222222-3333333')
    expect(scrubAudibleHtml(again)).toBe(out)
  })
})

describe('redactStrings', () => {
  test('replaces each string, ignoring case', () => {
    expect(
      redactStrings('Hello, Ada Lovelace (ADA)', ['ada', 'Lovelace'])
    ).toBe('Hello, REDACTED REDACTED (REDACTED)')
  })

  test('matches whole words only', () => {
    expect(redactStrings('Ada in Canada, Adam', ['Ada'])).toBe(
      'REDACTED in Canada, Adam'
    )
  })

  test('treats the text literally and ignores blanks', () => {
    expect(redactStrings('a.b and axb', ['a.b', ' '])).toBe('REDACTED and axb')
  })
})

describe('findPersonalData', () => {
  test.each([
    ['an email', 'mail me: someone@example.com'],
    ['an order id', 'order 123-4567890-1234567 shipped'],
    ['a customer id', '"customerId": "A2ABCDEF123456"'],
    ['a greeting with a name', '<span>Hello, Ophir</span>'],
  ])('flags %s', (_label, text) => {
    expect(findPersonalData(text)).not.toEqual([])
  })

  test('sees through the entity-encoded JSON Chrome writes into attributes', () => {
    expect(
      findPersonalData(
        'data-json="{&amp;quot;customerId&amp;quot;:&amp;quot;A2ABCDEF123456&amp;quot;}"'
      )
    ).not.toEqual([])
    expect(findPersonalData('"id":"amzn1.account.AFX4ZXYZ"')).not.toEqual([])
    expect(findPersonalData('digital order D01-1234567-7654321')).not.toEqual(
      []
    )
  })

  test('can skip the greeting check for book text', () => {
    expect(findPersonalData('Hello, Ron said', { greeting: false })).toEqual([])
    expect(findPersonalData('Hello, Ron said')).not.toEqual([])
  })

  test('accepts the placeholder email and ordinary text', () => {
    expect(
      findPersonalData(
        'redacted@example.invalid. Hello, REDACTED. Hello, readers. ASIN B08G9PRS1K'
      )
    ).toEqual([])
  })
})

describe('normaliseAutocomplete', () => {
  test('replaces the random qid and nothing else', () => {
    expect(normaliseAutocomplete([{ bookId: '1', qid: 'xYz' }])).toEqual([
      { bookId: '1', qid: 'fixture' },
    ])
  })

  test('rejects anything but an array', () => {
    expect(() => normaliseAutocomplete({ error: 'blocked' })).toThrow()
  })
})

describe('extractBookFixture', () => {
  // Next.js writes `<` as \u003c inside the script element; the helper does the same.
  const nextData = (apolloState: unknown, extra = {}) => {
    const json = JSON.stringify({
      props: {
        pageProps: {
          jwtToken: 'secret',
          apiKey: 'key',
          userAgent: 'ua',
          params: { book_id: '7' },
          apolloState,
          ...extra,
        },
      },
      buildId: 'b1',
    }).replace(/</g, '\\u003c')
    return `<html><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`
  }
  const state = {
    ROOT_QUERY: {
      __typename: 'Query',
      'getBookByLegacyId({"legacyId":"7"})': { __ref: 'Book:k1' },
      getReviews: { __ref: 'x' },
      getAdsTargeting: {},
    },
    'Book:k1': { __typename: 'Book', legacyId: 7, title: 'T' },
    'Work:w1': { __typename: 'Work' },
    'Contributor:c1': {
      __typename: 'Contributor',
      name: 'Author',
      user: { __ref: 'User:u1' },
    },
    'User:u1': { __typename: 'User', name: 'Reviewer Name' },
    'Review:r1': { __typename: 'Review', text: 'great' },
  }

  const read = (fixture: string) =>
    JSON.parse(
      fixture.slice(fixture.indexOf('>') + 1, fixture.lastIndexOf('</script>'))
    )

  test('keeps the book data, drops session values and reviewers', () => {
    const fixture = extractBookFixture(nextData(state), '7')
    const data = read(fixture)
    expect(Object.keys(data.props.pageProps.apolloState).sort()).toEqual([
      'Book:k1',
      'Contributor:c1',
      'ROOT_QUERY',
      'Work:w1',
    ])
    expect(Object.keys(data.props.pageProps.apolloState.ROOT_QUERY)).toEqual([
      '__typename',
      'getBookByLegacyId({"legacyId":"7"})',
    ])
    expect(data.props.pageProps.params).toEqual({ book_id: '7' })
    expect(data.buildId).toBe('b1')
    expect(fixture).not.toMatch(/jwtToken|apiKey|Reviewer Name|userAgent/)
  })

  test('escapes < so the JSON cannot close the script element', () => {
    const fixture = extractBookFixture(
      nextData({
        ...state,
        'Book:k1': { ...state['Book:k1'], description: '</script><b>x' },
      }),
      '7'
    )
    expect(fixture.match(/<\/script>/g)).toHaveLength(1)
    expect(
      read(fixture).props.pageProps.apolloState['Book:k1'].description
    ).toBe('</script><b>x')
  })

  test('drops Work.featuredKNH, which names a reader', () => {
    const fixture = extractBookFixture(
      nextData({
        ...state,
        'Work:w1': {
          __typename: 'Work',
          legacyId: 1,
          featuredKNH: { edges: [{ node: { creator: { __ref: 'User:9' } } }] },
        },
      }),
      '7'
    )
    expect(fixture).not.toContain('featuredKNH')
    expect(fixture).not.toContain('User:')
  })

  test('keeps only allowlisted fields outside apolloState', () => {
    const data = read(
      extractBookFixture(nextData(state, { accessToken: 'new-secret' }), '7')
    )
    expect(Object.keys(data.props.pageProps).sort()).toEqual([
      'apolloState',
      'params',
    ])
    expect(Object.keys(data).sort()).toEqual(['buildId', 'props'])
  })

  test('fails closed if a user reference survives the filters', () => {
    expect(() =>
      extractBookFixture(
        nextData({
          ...state,
          'Book:k1': { ...state['Book:k1'], seenBy: { __ref: 'User:9' } },
        }),
        '7'
      )
    ).toThrow('personal data')
  })

  test('throws on a page of the wrong shape', () => {
    expect(() => extractBookFixture('<html>blocked</html>', '7')).toThrow(
      'no __NEXT_DATA__'
    )
    expect(() => extractBookFixture(nextData({}), '7')).toThrow('legacyId 7')
    expect(() => extractBookFixture(nextData(state), '8')).toThrow('legacyId 8')
  })
})
