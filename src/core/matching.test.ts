import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BookQuery,
  bareTitle,
  type Candidate,
  chooseMatch,
  type Match,
  needsAuthorSearch,
  scoreCandidates,
  titleAuthorQuery,
} from '@/core/matching'

// ---------- fixtures ----------

const ROOT = join(import.meta.dir, '../../test/fixtures/goodreads/autocomplete')
const list = (slug: string, kind: 'title' | 'title-author') =>
  JSON.parse(
    readFileSync(join(ROOT, `${slug}.${kind}.json`), 'utf8')
  ) as readonly Candidate[]

/** The Audible title and author of each fixture book, read from the capture script's BOOKS table. */
const SCRIPT = readFileSync(
  join(import.meta.dir, '../../scripts/capture-fixtures.ts'),
  'utf8'
)
const BOOKS = [
  ...SCRIPT.matchAll(
    /\{ slug: '([^']+)', title: ("[^"]*"|'[^']*'), author: '([^']*)', id: '(\d+)' \}/g
  ),
].map(m => ({
  slug: m[1] as string,
  title: (m[2] as string).slice(1, -1),
  author: m[3] as string,
  pinnedId: m[4] as string,
}))
const book = (slug: string) => {
  const found = BOOKS.find(b => b.slug === slug)
  if (!found) throw new Error(`no book ${slug} in scripts/capture-fixtures.ts`)
  return found
}

/**
 * What the service will do, in-process: ask for the title-only list, then ask for the title + author
 * list only when `needsAuthorSearch` says so. `fetched` records which lists were requested.
 */
function lookup(
  query: BookQuery,
  fetch: (kind: 'title' | 'title-author') => readonly Candidate[]
) {
  const fetched: string[] = []
  const get = (kind: 'title' | 'title-author') => {
    fetched.push(kind)
    return fetch(kind)
  }
  const first = scoreCandidates(get('title'), query)
  const second = needsAuthorSearch(first, query)
    ? scoreCandidates(get('title-author'), query)
    : []
  return { match: chooseMatch(first, second), fetched }
}
const lookupFixture = (slug: string, title?: string, author?: string) => {
  const b = book(slug)
  return lookup({ title: title ?? b.title, author: author ?? b.author }, kind =>
    list(slug, kind)
  )
}

// ---------- the oracle ----------

// How these values were derived: the userscript's `norm`, `shortTitle`, `lastName` and the scoring
// and ranking in `searchGoodreads` (reference/audible-goodreads-ratings.user.js v2.4.0, L242-277)
// were copied verbatim into a throwaway script, with `get` replaced by a read of the two fixture
// files, and run over the title and author in scripts/capture-fixtures.ts BOOKS. The output is
// pasted here. Nothing in this table was computed by src/core/matching.ts.
//
// `pinned: false` marks a book where the userscript picks a different Goodreads book than the one
// pinned in BOOKS (which only decides which book page the capture script saves).
// biome-ignore format: one book per line reads as a table
const ORACLE: Readonly<Record<string, { id: string; loose: boolean; rating: number; count: number; url: string; pinned: boolean }>> = {
  'project-hail-mary': { id: '54493401', loose: false, rating: 4.51, count: 1923227, url: 'https://www.goodreads.com/book/show/54493401-project-hail-mary', pinned: true },
  'the-martian': { id: '18007564', loose: false, rating: 4.42, count: 1392522, url: 'https://www.goodreads.com/book/show/18007564-the-martian', pinned: true },
  'harry-potter-1': { id: '38135959', loose: false, rating: 4.47, count: 11890916, url: 'https://www.goodreads.com/book/show/38135959-harry-potter-and-the-sorcerer-s-stone', pinned: false },
  'dune': { id: '44767458', loose: false, rating: 4.29, count: 1723399, url: 'https://www.goodreads.com/book/show/44767458-dune', pinned: true },
  'the-hobbit': { id: '5907', loose: false, rating: 4.3, count: 4660090, url: 'https://www.goodreads.com/book/show/5907.The_Hobbit_or_There_and_Back_Again', pinned: true },
  '1984': { id: '61439040', loose: false, rating: 4.21, count: 5812665, url: 'https://www.goodreads.com/book/show/61439040-1984', pinned: true },
  'atomic-habits': { id: '40121378', loose: false, rating: 4.3, count: 1440806, url: 'https://www.goodreads.com/book/show/40121378-atomic-habits', pinned: true },
  'sapiens': { id: '23692271', loose: false, rating: 4.32, count: 1339420, url: 'https://www.goodreads.com/book/show/23692271-sapiens', pinned: true },
  'the-way-of-kings': { id: '7235533', loose: false, rating: 4.66, count: 734972, url: 'https://www.goodreads.com/book/show/7235533-the-way-of-kings', pinned: true },
  'the-name-of-the-wind': { id: '186074', loose: false, rating: 4.52, count: 1125273, url: 'https://www.goodreads.com/book/show/186074.The_Name_of_the_Wind', pinned: true },
  'circe': { id: '35959740', loose: false, rating: 4.22, count: 1501102, url: 'https://www.goodreads.com/book/show/35959740-circe', pinned: true },
  'the-road': { id: '6288', loose: false, rating: 4, count: 1097564, url: 'https://www.goodreads.com/book/show/6288.The_Road', pinned: true },
  'educated': { id: '35133922', loose: false, rating: 4.46, count: 1993689, url: 'https://www.goodreads.com/book/show/35133922-educated', pinned: true },
  'thinking-fast-and-slow': { id: '11468377', loose: false, rating: 4.16, count: 621462, url: 'https://www.goodreads.com/book/show/11468377-thinking-fast-and-slow', pinned: true },
  'the-subtle-art': { id: '28257707', loose: false, rating: 3.85, count: 1499144, url: 'https://www.goodreads.com/book/show/28257707-the-subtle-art-of-not-giving-a-f-ck', pinned: true },
  'les-miserables': { id: '24280', loose: false, rating: 4.22, count: 869002, url: 'https://www.goodreads.com/book/show/24280.Les_Mis_rables', pinned: true },
  'the-girl-with-the-dragon-tattoo': { id: '2429135', loose: false, rating: 4.18, count: 3540873, url: 'https://www.goodreads.com/book/show/2429135.The_Girl_With_the_Dragon_Tattoo', pinned: true },
  'the-fellowship-of-the-ring': { id: '61215351', loose: false, rating: 4.41, count: 3251457, url: 'https://www.goodreads.com/book/show/61215351-the-fellowship-of-the-ring', pinned: true },
  'becoming': { id: '38746485', loose: false, rating: 4.43, count: 1253288, url: 'https://www.goodreads.com/book/show/38746485-becoming', pinned: true },
  'rich-dad-poor-dad': { id: '69571', loose: false, rating: 4.08, count: 768377, url: 'https://www.goodreads.com/book/show/69571.Rich_Dad_Poor_Dad', pinned: true },
}

// Why the userscript's choice differs from the id pinned in BOOKS.
const WHY_NOT_PINNED: Readonly<Record<string, string>> = {
  // Pinned id 3 is the UK edition ("Philosopher's Stone"). Neither list for the US title contains
  // it; the userscript takes 38135959, the "Sorcerer's Stone" edition of the same work (same
  // ratings count), which is the right book to show a US title.
  'harry-potter-1': '3 is the UK-titled edition and is in neither list',
}

const matchKey = (m: Match | undefined) =>
  m && {
    id: m.bookId,
    loose: m.loose,
    rating: m.rating,
    count: m.count,
    url: m.url,
  }

/** A candidate by Isaac Asimov, as the autocomplete returns them, for hand-made cases. */
const cand = (
  bookId: string,
  title: string,
  ratingsCount: number | undefined,
  extra: Partial<Candidate> = {}
): Candidate => ({
  bookId,
  title,
  bookTitleBare: title,
  author: { name: 'Isaac Asimov' },
  avgRating: '4.0',
  ratingsCount,
  bookUrl: `/book/show/${bookId}-x`,
  ...extra,
})

describe('the 20 fixture books', () => {
  test('are the 20 in the oracle table', () => {
    expect(BOOKS.length).toBe(20)
    expect(BOOKS.map(b => b.slug).sort()).toEqual(Object.keys(ORACLE).sort())
  })

  test('the oracle and the pinned ids disagree only where explained', () => {
    const differing = BOOKS.filter(b => ORACLE[b.slug]?.id !== b.pinnedId).map(
      b => b.slug
    )
    expect(differing.sort()).toEqual(Object.keys(WHY_NOT_PINNED).sort())
    for (const b of BOOKS) {
      expect(ORACLE[b.slug]?.pinned).toBe(!(b.slug in WHY_NOT_PINNED))
    }
  })

  for (const b of BOOKS) {
    const want = ORACLE[b.slug]
    test(`${b.slug} matches what the userscript chooses`, () => {
      const { match } = lookupFixture(b.slug)
      expect(matchKey(match)).toEqual(
        want && {
          id: want.id,
          loose: want.loose,
          rating: want.rating,
          count: want.count,
          url: want.url,
        }
      )
    })
  }

  test('every one is found in the title-only list: the title + author list is never requested', () => {
    for (const b of BOOKS) {
      const { fetched } = lookupFixture(b.slug)
      expect(fetched).toEqual(['title'])
    }
  })

  test('the title + author list would not have changed any choice either', () => {
    // Scoring both lists regardless gives the same winner: the second list only holds summaries and
    // study guides, which is why the userscript asks for the title alone first.
    for (const b of BOOKS) {
      const query = { title: b.title, author: b.author }
      const first = scoreCandidates(list(b.slug, 'title'), query)
      const second = scoreCandidates(list(b.slug, 'title-author'), query)
      expect(matchKey(chooseMatch(first, second))).toEqual(
        matchKey(chooseMatch(first))
      )
    }
  })
})

describe('motivating books', () => {
  const scored = (slug: string, kind: 'title' | 'title-author' = 'title') => {
    const b = book(slug)
    return scoreCandidates(list(slug, kind), {
      title: b.title,
      author: b.author,
    })
  }
  const ids = (s: ReturnType<typeof scored>) =>
    s.map(x => `${x.candidate.bookId}:${x.score}`)

  // The expected score lists below are the oracle's, same derivation as ORACLE.

  test('Project Hail Mary: summary editions score nothing and are dropped', () => {
    // Four candidates came back: the novel, an omnibus (same author, title starts the same) and two
    // "Summary & Analysis" books by other authors.
    expect(list('project-hail-mary', 'title').length).toBe(4)
    expect(ids(scored('project-hail-mary'))).toEqual([
      '54493401:3',
      '119255205:3',
    ])
    // Asked with the author, Goodreads returns only summaries and study guides; none survives.
    expect(list('project-hail-mary', 'title-author').length).toBe(5)
    expect(ids(scored('project-hail-mary', 'title-author'))).toEqual([])
  })

  test('The Martian: The Martian Chronicles is a different author and is dropped', () => {
    const martian = list('the-martian', 'title')
    expect(martian.map(c => c.title)).toContain('The Martian Chronicles')
    // Its title starts with ours (1 point) but Ray Bradbury is not Andy Weir, and with an author
    // known a title-only score is not enough.
    expect(ids(scored('the-martian'))).toEqual(['18007564:3', '26852117:2'])
  })

  test('The Road: On the Road is not a candidate even though it ranks second', () => {
    expect(list('the-road', 'title').map(c => c.bookId)).toContain('70401')
    // "on the road" neither equals nor starts with "the road", and Kerouac is not McCarthy.
    // The Road to Tender Hearts and The Road of Bones start with our title but have other authors.
    expect(ids(scored('the-road'))).toEqual(['6288:3'])
  })

  test('The Road: without an author the other books that start with the title compete', () => {
    // Same list, author unknown: the author check passes for free, so every title that starts with
    // "the road" scores 3 and the rest score 2. The most-rated 3 still wins here, but the author is
    // what keeps the other "The Road" books out of the running.
    const query = { title: 'The Road', author: undefined }
    const s = scoreCandidates(list('the-road', 'title'), query)
    expect(ids(s)).toEqual([
      '6288:3',
      '70401:2',
      '218460347:3',
      '205044632:3',
      '3463:2',
    ])
    expect(matchKey(chooseMatch(s))?.id).toBe('6288')
  })

  test('Les Misérables: diacritics fold, and the same title by another author is dropped', () => {
    // 'Misérables' (Audible, composed) against Goodreads' text: both normalise to "les miserables".
    // Stacy King's manga has the same title and scores 1, dropped; Fantine by Hugo scores 2.
    expect(ids(scored('les-miserables'))).toEqual(['24280:3', '1572079:2'])
    expect(
      scoreCandidates(list('les-miserables', 'title'), {
        title: 'Les Misérables', // decomposed form, as some pages serve it
        author: 'Victor Hugo',
      }).map(x => x.candidate.bookId)
    ).toEqual(['24280', '1572079'])
  })

  test('1984: a numeric title matches, and a different author with the same title does not', () => {
    // Michael Dean's "1984" scores 1 and is dropped. Animal Farm / 1984 (Orwell) scores 2: the
    // author matches and "animal farm 1984" does not start with "1984".
    expect(ids(scored('1984'))).toEqual(['61439040:3', '5472:2'])
  })

  test('The Subtle Art of Not Giving a F*ck: the asterisk is punctuation on both sides', () => {
    // Three books by Mark Manson score 3 (the book, its journal, a bundle); the most-rated wins.
    // The "Summary: ..." books by other authors start with "summary" and drop out.
    expect(ids(scored('the-subtle-art'))).toEqual([
      '28257707:3',
      '58733709:3',
      '40198840:3',
    ])
    expect(lookupFixture('the-subtle-art').match?.bookId).toBe('28257707')
  })
})

describe('the two searches', () => {
  test('bareTitle cuts at the first colon, en dash or em dash, but not at a spaced hyphen', () => {
    expect(bareTitle('Dune: Book One in the Dune Chronicles')).toBe('Dune')
    expect(bareTitle('The Hobbit – Or There and Back Again')).toBe('The Hobbit')
    expect(bareTitle('Title — Subtitle')).toBe('Title')
    expect(bareTitle('  Padded : Sub')).toBe('Padded')
    expect(bareTitle('Thinking, Fast and Slow')).toBe('Thinking, Fast and Slow')
    // shortTitle splits on ` - ` for comparing; the query the userscript sends does not.
    expect(bareTitle('Title - Subtitle')).toBe('Title - Subtitle')
  })

  test('the queries are the two the capture script sent', () => {
    const b = book('dune')
    expect(bareTitle(b.title)).toBe('Dune')
    expect(titleAuthorQuery(b.title, b.author)).toBe('Dune Frank Herbert')
    const f = book('the-subtle-art')
    expect(bareTitle(f.title)).toBe('The Subtle Art of Not Giving a F*ck')
  })

  test('the second search is needed only when no candidate scored 3 and an author is known', () => {
    const query: BookQuery = { title: 'Foundation', author: 'Isaac Asimov' }
    const exact = scoreCandidates([cand('a', 'Foundation', 10)], query)
    const roughOnly = scoreCandidates([cand('b', 'Prelude', 10)], query)
    expect(needsAuthorSearch(exact, query)).toBe(false)
    expect(needsAuthorSearch(roughOnly, query)).toBe(true)
    expect(needsAuthorSearch([], query)).toBe(true)
    // A 3 anywhere in the list is enough, even with a more popular score-2 candidate ahead of it.
    const mixed = scoreCandidates(
      [cand('b', 'Prelude', 99), cand('a', 'Foundation', 10)],
      query
    )
    expect(needsAuthorSearch(mixed, query)).toBe(false)
    // No author known: the title + author query would be meaningless, so there is no second search.
    for (const author of [undefined, null, '']) {
      expect(needsAuthorSearch([], { title: 'Foundation', author })).toBe(false)
    }
  })

  test('the title + author list is requested after a title-only list with no 3, and can win', () => {
    // Oracle: the only first-list candidate scores 2 (author, wrong title); the second list holds
    // a 3, which beats the 2 although the 2 has 900 times the ratings. Not loose.
    const query: BookQuery = { title: 'Foundation', author: 'Isaac Asimov' }
    const first = [cand('a', 'Totally Different', 9000)]
    const second = [cand('b', 'Foundation', 10)]
    const { match, fetched } = lookup(query, kind =>
      kind === 'title' ? first : second
    )
    expect(fetched).toEqual(['title', 'title-author'])
    expect(match).toEqual({
      bookId: 'b',
      rating: 4,
      count: 10,
      url: 'https://www.goodreads.com/book/show/b-x',
      loose: false,
    })
  })

  test('the title + author list is not requested, or looked at, when the title-only list has a 3', () => {
    const query: BookQuery = { title: 'Foundation', author: 'Isaac Asimov' }
    const { match, fetched } = lookup(query, kind =>
      kind === 'title'
        ? [cand('a', 'Foundation', 10)]
        : [cand('z', 'Foundation', 99999)]
    )
    expect(fetched).toEqual(['title'])
    expect(match?.bookId).toBe('a')
  })
})

describe('the approximate-match rule', () => {
  test('no 3 anywhere gives a loose match, taken from the most-rated 2', () => {
    // Oracle, on the Subtle Art fixtures with the Audible title shortened to "Subtle Art of Not
    // Giving a F*ck": nothing starts with that, so every Mark Manson book scores 2, the second
    // list is fetched and adds nothing, and the most-rated of them is the right book, flagged.
    const { match, fetched } = lookupFixture(
      'the-subtle-art',
      'Subtle Art of Not Giving a F*ck: A Counterintuitive Approach'
    )
    expect(fetched).toEqual(['title', 'title-author'])
    expect(matchKey(match)).toEqual({
      id: '28257707',
      loose: true,
      rating: 3.85,
      count: 1499144,
      url: 'https://www.goodreads.com/book/show/28257707-the-subtle-art-of-not-giving-a-f-ck',
    })
  })

  test('a 3 is exact and a 2 is loose, however popular', () => {
    const query: BookQuery = { title: 'Foundation', author: 'Isaac Asimov' }
    const { match } = lookup(query, () => [
      cand('a', 'Totally Different', 9000),
      cand('b', 'Foundation', 1),
    ])
    expect(match?.bookId).toBe('b')
    expect(match?.loose).toBe(false)
  })
})

describe('choosing', () => {
  const query: BookQuery = { title: 'Foundation', author: 'Isaac Asimov' }

  test('no candidate that clears the bar is a miss', () => {
    // Oracle: The Road by "Nobody Else": every candidate has a different author, the title-only
    // score of 1 does not count once an author is known, and both lists come up empty.
    const { match, fetched } = lookupFixture(
      'the-road',
      undefined,
      'Nobody Else'
    )
    expect(fetched).toEqual(['title', 'title-author'])
    expect(match).toBeUndefined()
    expect(chooseMatch([])).toBeUndefined()
    expect(chooseMatch([], [])).toBeUndefined()
    const wrongAuthor = lookup(query, () => [
      cand('t1', 'Foundation', 5, { author: { name: 'Someone Else' } }),
    ])
    expect(wrongAuthor.match).toBeUndefined()
  })

  test('with no author known every candidate passes the author check', () => {
    // Oracle: Dune with an empty author. Dune and Dune Messiah both start with "dune" and tie on 3;
    // the more-rated Dune wins, and there is no second search.
    const withEmpty = lookupFixture('dune', undefined, '')
    expect(withEmpty.fetched).toEqual(['title'])
    expect(matchKey(withEmpty.match)).toMatchObject({
      id: '44767458',
      loose: false,
    })
    // Oracle: The Road with no author at all behaves the same.
    const none = lookup({ title: 'The Road', author: undefined }, () =>
      list('the-road', 'title')
    )
    expect(none.match?.bookId).toBe('6288')
    expect(none.match?.loose).toBe(false)
  })

  test('equal score and equal ratings count: the earlier candidate wins', () => {
    // Oracle: Array.prototype.sort is stable, so input order breaks the tie.
    const same = lookup(query, () => [
      cand('s1', 'Foundation', 100, { avgRating: '4.2' }),
      cand('s2', 'Foundation', 100, { avgRating: '4.1' }),
    ])
    expect(same.match).toMatchObject({ bookId: 's1', rating: 4.2, count: 100 })
    // Across the two lists the title-only list comes first.
    const across = lookup(query, kind =>
      kind === 'title'
        ? [cand('a1', 'Totally Different', 50)]
        : [cand('b1', 'Another Different', 50, { avgRating: '4.4' })]
    )
    expect(across.fetched).toEqual(['title', 'title-author'])
    expect(across.match).toMatchObject({ bookId: 'a1', rating: 4, loose: true })
  })

  test('chooseMatch concatenates the lists in order and does not mutate them', () => {
    const first = scoreCandidates([cand('a', 'Foundation', 1)], query)
    const second = scoreCandidates([cand('b', 'Foundation', 2)], query)
    const frozenFirst = Object.freeze([...first])
    const frozenSecond = Object.freeze([...second])
    expect(chooseMatch(frozenFirst, frozenSecond)?.bookId).toBe('b')
    expect(frozenFirst.map(x => x.candidate.bookId)).toEqual(['a'])
    expect(frozenSecond.map(x => x.candidate.bookId)).toEqual(['b'])
  })

  test('a missing rating or ratings count is 0, and the book URL loses its query string', () => {
    // Oracle: parseFloat(undefined) || 0, undefined || 0, and bookUrl.split("?")[0].
    const bare = lookup(query, () => [
      {
        bookId: 'm1',
        title: 'Foundation',
        author: { name: 'Isaac Asimov' },
        bookUrl: '/book/show/m1-foundation?from_search=true&qid=abc',
      },
    ])
    expect(bare.match).toEqual({
      bookId: 'm1',
      rating: 0,
      count: 0,
      url: 'https://www.goodreads.com/book/show/m1-foundation',
      loose: false,
    })
    const empty = lookup(query, () => [
      cand('e1', 'Foundation', undefined, { avgRating: '' }),
    ])
    expect(empty.match).toMatchObject({ bookId: 'e1', rating: 0, count: 0 })
    // Some responses carry the rating as a number.
    const numeric = lookup(query, () => [
      cand('n1', 'Foundation', 12, { avgRating: 4.5 }),
    ])
    expect(numeric.match).toMatchObject({
      bookId: 'n1',
      rating: 4.5,
      count: 12,
    })
  })

  test('the title is compared on its bare form, the author on its last name', () => {
    const l = [
      cand('x', 'Foundation (Foundation, #1)', 1, { bookTitleBare: undefined }),
    ]
    expect(chooseMatch(scoreCandidates(l, query))?.bookId).toBe('x')
    // `bookTitleBare` wins over `title` when both are there.
    const bare = [
      cand('y', 'Summary of Foundation', 1, { bookTitleBare: 'Foundation' }),
    ]
    expect(chooseMatch(scoreCandidates(bare, query))?.bookId).toBe('y')
    // The author needs only to contain the last name.
    const named = [
      cand('z', 'Foundation', 1, { author: { name: 'I. Asimov (Editor)' } }),
    ]
    expect(chooseMatch(scoreCandidates(named, query))?.bookId).toBe('z')
    // Title prefix in either direction counts.
    const longer = [cand('p', 'Foundation and Empire', 1)]
    expect(scoreCandidates(longer, query).map(x => x.score)).toEqual([3])
    const shorter = [cand('q', 'Found', 1)]
    expect(scoreCandidates(shorter, query).map(x => x.score)).toEqual([3])
  })
})
