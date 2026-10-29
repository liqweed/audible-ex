#!/usr/bin/env bun
/**
 * Refreshes the fixtures under test/fixtures/ (see test/fixtures/README.md for what each one is).
 * Run it by hand when Audible or Goodreads change their pages; it never runs in CI and refuses to.
 *
 *   bun scripts/capture-fixtures.ts                 audible pages + goodreads responses
 *   bun scripts/capture-fixtures.ts audible         the public Audible pages only
 *   bun scripts/capture-fixtures.ts goodreads       autocomplete responses and book pages only
 *   bun scripts/capture-fixtures.ts --list          print every request it would make; send none
 *   bun scripts/capture-fixtures.ts import <library|wishlist> <uk|com> <saved.html> [--redact <text>]...
 *
 * Respect the sources (AGENTS.md): one request at a time, PAUSE_MS between any two, no cookies,
 * the script's own honest User-Agent, and on 429/503 it backs off and then gives up on that site
 * for this run instead of pressing on.
 *
 * A fixture is only replaced by a page that passes its checks (right site, enough books, no
 * personal data), so a block page or a layout change never overwrites a good fixture; it is
 * reported as a failure and the script exits 1. Output carries no timestamps or request ids
 * (scripts/fixture-scrub.ts), so running it twice changes only what the sites themselves changed.
 *
 * Library and wish list need a signed-in browser, so they are saved by hand and cleaned by the
 * `import` command; the steps are in test/fixtures/README.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  extractBookFixture,
  findPersonalData,
  normaliseAutocomplete,
  redactStrings,
  scrubAudibleHtml,
} from './fixture-scrub'

const FIXTURES = join(import.meta.dir, '..', 'test', 'fixtures')
const PAUSE_MS = 2000
const REQUEST_TIMEOUT_MS = 30_000
const BACKOFF_MS = [10_000, 60_000]
const MAX_RETRY_AFTER_MS = 120_000
const MAX_REDIRECTS = 5
const USER_AGENT =
  'audible-ex-fixture-capture (+https://github.com/liqweed/audible-ex)'

// ---------- what to capture ----------

// `ipRedirectOverride` is Audible's own parameter for "stay on this marketplace"; without it
// audible.com sends a visitor outside the US to their local site.
const REGIONS = {
  uk: { origin: 'https://www.audible.co.uk', category: '19378442031' },
  com: { origin: 'https://www.audible.com', category: '18580606011' },
} as const
type Region = keyof typeof REGIONS

const audiblePath = (type: PublicPage) =>
  ({
    home: '/',
    search: '/search?keywords=andy+weir',
    category: (r: Region) =>
      `/cat/Science-Fiction-Fantasy-Audiobooks/${REGIONS[r].category}`,
    deals: '/ep/audiobook-deals',
  })[type]
type PublicPage = 'home' | 'search' | 'category' | 'deals'
const PUBLIC_PAGES: PublicPage[] = ['home', 'search', 'category', 'deals']

type Book = { slug: string; title: string; author: string; id: string }
// Titles and authors are written the way Audible lists them, because the queries are built from
// them the way the userscript builds them. The Goodreads id is pinned so a refresh keeps fetching
// the same book page even if the autocomplete order shifts. Why each is here: README.md.
// biome-ignore format: one book per line reads as a table
const BOOKS: Book[] = [
  { slug: 'project-hail-mary', title: 'Project Hail Mary', author: 'Andy Weir', id: '54493401' },
  { slug: 'the-martian', title: 'The Martian', author: 'Andy Weir', id: '18007564' },
  { slug: 'harry-potter-1', title: "Harry Potter and the Sorcerer's Stone, Book 1", author: 'J.K. Rowling', id: '3' },
  { slug: 'dune', title: 'Dune: Book One in the Dune Chronicles', author: 'Frank Herbert', id: '44767458' },
  { slug: 'the-hobbit', title: 'The Hobbit', author: 'J.R.R. Tolkien', id: '5907' },
  { slug: '1984', title: '1984', author: 'George Orwell', id: '61439040' },
  { slug: 'atomic-habits', title: 'Atomic Habits: Tiny Changes, Remarkable Results', author: 'James Clear', id: '40121378' },
  { slug: 'sapiens', title: 'Sapiens: A Brief History of Humankind', author: 'Yuval Noah Harari', id: '23692271' },
  { slug: 'the-way-of-kings', title: 'The Way of Kings: Book One of the Stormlight Archive', author: 'Brandon Sanderson', id: '7235533' },
  { slug: 'the-name-of-the-wind', title: 'The Name of the Wind: The Kingkiller Chronicle, Book 1', author: 'Patrick Rothfuss', id: '186074' },
  { slug: 'circe', title: 'Circe', author: 'Madeline Miller', id: '35959740' },
  { slug: 'the-road', title: 'The Road', author: 'Cormac McCarthy', id: '6288' },
  { slug: 'educated', title: 'Educated: A Memoir', author: 'Tara Westover', id: '35133922' },
  { slug: 'thinking-fast-and-slow', title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', id: '11468377' },
  { slug: 'the-subtle-art', title: 'The Subtle Art of Not Giving a F*ck: A Counterintuitive Approach to Living a Good Life', author: 'Mark Manson', id: '28257707' },
  { slug: 'les-miserables', title: 'Les Misérables', author: 'Victor Hugo', id: '24280' },
  { slug: 'the-girl-with-the-dragon-tattoo', title: 'The Girl with the Dragon Tattoo: Millennium Series, Book 1', author: 'Stieg Larsson', id: '2429135' },
  { slug: 'the-fellowship-of-the-ring', title: 'The Fellowship of the Ring: The Lord of the Rings, Book 1', author: 'J.R.R. Tolkien', id: '61215351' },
  { slug: 'becoming', title: 'Becoming', author: 'Michelle Obama', id: '38746485' },
  { slug: 'rich-dad-poor-dad', title: 'Rich Dad Poor Dad: 20th Anniversary Edition', author: 'Robert T. Kiyosaki', id: '69571' },
]

// The same two queries the userscript sends: the title before any subtitle, then title + author.
const queriesFor = ({ title, author }: Book) => {
  const bare = title.split(/[:–—]/)[0]?.trim() ?? title
  return [
    { kind: 'title', q: bare },
    { kind: 'title-author', q: `${bare} ${author}` },
  ]
}

// ---------- requests ----------

class SiteBackedOff extends Error {}

let lastRequestEnd = 0
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Retry-After as milliseconds: seconds, or an HTTP date. */
function retryAfterMs(header: string | null): number {
  if (!header) return 0
  const seconds = Number(header)
  const ms = Number.isNaN(seconds)
    ? Date.parse(header) - Date.now()
    : seconds * 1000
  return Number.isNaN(ms) ? 0 : Math.max(0, ms)
}

/**
 * One GET with the courtesy rules: PAUSE_MS between any two requests (counted from the end of the
 * previous download), redirects followed only within the same host, a wait and retry on 429/503
 * (never sooner than Retry-After), and SiteBackedOff, which stops the site for this run, when that
 * does not help, when Retry-After asks for more than we will wait, or on 403.
 */
async function get(startUrl: string, accept: string): Promise<string> {
  let url = startUrl
  let backoffs = 0
  let hops = 0
  for (;;) {
    await sleep(Math.max(0, lastRequestEnd + PAUSE_MS - Date.now()))
    let response: Response
    let body: string
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept,
          'Accept-Language': 'en',
        },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      body = await response.text()
    } finally {
      lastRequestEnd = Date.now()
    }
    const { status } = response
    if (status >= 300 && status < 400) {
      const next = new URL(response.headers.get('location') ?? '', url)
      if (next.host !== new URL(startUrl).host) {
        throw new Error(`redirected to ${next.host}`)
      }
      if (++hops > MAX_REDIRECTS) throw new Error('too many redirects')
      url = next.href
      continue
    }
    if (status === 403) throw new SiteBackedOff('HTTP 403')
    if (status === 429 || status === 503) {
      const wait = BACKOFF_MS[backoffs++]
      const asked = retryAfterMs(response.headers.get('retry-after'))
      if (wait === undefined || asked > MAX_RETRY_AFTER_MS) {
        throw new SiteBackedOff(`HTTP ${status}, backing off did not help`)
      }
      const delay = Math.max(wait, asked)
      console.log(`  HTTP ${status}; waiting ${delay / 1000}s`)
      await sleep(delay)
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${status}`)
    return body
  }
}

// ---------- jobs ----------

type Job = {
  site: string
  file: string
  request: string
  run: () => Promise<string>
}

const MIN_BOOKS = 10
function checkedAudible(html: string, source: string, minBooks = MIN_BOOKS) {
  const page = scrubAudibleHtml(html)
  const books = new Set(page.match(/\/pd\/[\w-]+\/[A-Z0-9]{10}/g)).size
  if (/<title>[^<]*(Whoops|Robot Check)/i.test(page) || books < minBooks) {
    throw new Error(
      `${source} does not look like a book page (${books} book links)`
    )
  }
  const personal = findPersonalData(page)
  if (personal.length) {
    throw new Error(
      `${source} still has personal data: ${personal.slice(0, 3).join('; ')}`
    )
  }
  return page
}

function audibleJobs(): Job[] {
  return (Object.keys(REGIONS) as Region[]).flatMap(region =>
    PUBLIC_PAGES.map(type => {
      const path = audiblePath(type)
      const url = new URL(
        typeof path === 'function' ? path(region) : path,
        REGIONS[region].origin
      )
      url.searchParams.set('ipRedirectOverride', 'true')
      return {
        site: 'audible',
        file: `audible/${region}/${type}.html`,
        request: url.href,
        run: async () =>
          checkedAudible(await get(url.href, 'text/html'), url.href),
      }
    })
  )
}

function goodreadsJobs(): Job[] {
  return BOOKS.flatMap(book => [
    ...queriesFor(book).map(({ kind, q }) => {
      const url = `https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(q)}`
      return {
        site: 'goodreads',
        file: `goodreads/autocomplete/${book.slug}.${kind}.json`,
        request: url,
        run: async () => {
          const list = normaliseAutocomplete(
            JSON.parse(await get(url, 'application/json'))
          )
          if (!(list as unknown[]).length)
            throw new Error(`no results for "${q}"`)
          const json = `${JSON.stringify(list, null, 2)}\n`
          const personal = findPersonalData(json, { greeting: false })
          if (personal.length) {
            throw new Error(`response has personal data: ${personal[0]}`)
          }
          return json
        },
      }
    }),
    (() => {
      const url = `https://www.goodreads.com/book/show/${book.id}`
      return {
        site: 'goodreads',
        file: `goodreads/book/${book.id}-${book.slug}.html`,
        request: url,
        run: async () =>
          extractBookFixture(await get(url, 'text/html'), book.id),
      }
    })(),
  ])
}

function writeIfChanged(
  file: string,
  content: string
): 'new' | 'updated' | 'unchanged' {
  const path = join(FIXTURES, file)
  let before: string | undefined
  try {
    before = readFileSync(path, 'utf8')
  } catch {}
  if (before === content) return 'unchanged'
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return before === undefined ? 'new' : 'updated'
}

async function capture(jobs: Job[]): Promise<boolean> {
  const counts = { new: 0, updated: 0, unchanged: 0, failed: 0 }
  const backedOff = new Set<string>()
  for (const [i, job] of jobs.entries()) {
    const label = `[${i + 1}/${jobs.length}] ${job.file}`
    if (backedOff.has(job.site)) {
      console.log(`${label}: skipped, ${job.site} asked us to slow down`)
      counts.failed++
      continue
    }
    try {
      const result = writeIfChanged(job.file, await job.run())
      counts[result]++
      console.log(`${label}: ${result}`)
    } catch (error) {
      counts.failed++
      if (error instanceof SiteBackedOff) backedOff.add(job.site)
      console.error(
        `${label}: FAILED, kept the old file. ${(error as Error).message}`
      )
    }
  }
  console.log(
    `\n${counts.new} new, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.failed} failed`
  )
  if (counts.new + counts.updated) {
    console.log('Review `git diff --stat test/fixtures` before committing.')
  }
  return counts.failed === 0
}

// ---------- import (signed-in pages saved by hand) ----------

function importPage(argv: string[]): boolean {
  const redact: string[] = []
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--redact') redact.push(argv[++i] ?? '')
    else positional.push(argv[i] as string)
  }
  const [kind, region, saved] = positional
  if (
    (kind !== 'library' && kind !== 'wishlist') ||
    !(region && region in REGIONS) ||
    !saved
  ) {
    console.error(
      'usage: bun scripts/capture-fixtures.ts import <library|wishlist> <uk|com> <saved.html> [--redact <text>]...'
    )
    return false
  }
  try {
    const page = checkedAudible(
      redactStrings(scrubAudibleHtml(readFileSync(saved, 'utf8')), redact),
      saved,
      1
    )
    const file = `audible/${region}/${kind}.html`
    console.log(`${file}: ${writeIfChanged(file, page)}`)
    console.log(
      'Read the file once before committing: names are only removed if you passed them to --redact.'
    )
    return true
  } catch (error) {
    console.error(`FAILED. ${(error as Error).message}`)
    return false
  }
}

// ---------- main ----------

const [command, ...rest] = process.argv.slice(2)

if (process.env.CI) {
  console.error(
    'capture-fixtures never runs in CI: it sends requests to live sites.'
  )
  process.exit(1)
}

if (command === 'import') {
  process.exit(importPage(rest) ? 0 : 1)
}

// Anything unrecognised stops here: a mistyped `--lst` must not start 68 live requests.
const targets = {
  audible: audibleJobs,
  goodreads: goodreadsJobs,
} as const
const list = process.argv.slice(2).includes('--list')
const args = process.argv.slice(2).filter(a => a !== '--list')
const target = args[0]
if (
  args.length > 1 ||
  (target !== undefined && !(target in targets)) ||
  (target?.startsWith('--') ?? false)
) {
  console.error(
    `unknown argument "${args.join(' ')}"; see the header of scripts/capture-fixtures.ts`
  )
  process.exit(1)
}
const jobs = (
  target ? [target] : (Object.keys(targets) as (keyof typeof targets)[])
).flatMap(t => targets[t as keyof typeof targets]())

if (list) {
  for (const job of jobs) console.log(`${job.file}\t${job.request}`)
  console.log(
    `${jobs.length} requests, about ${Math.ceil((jobs.length * PAUSE_MS) / 60_000)} minutes`
  )
} else {
  process.exit((await capture(jobs)) ? 0 : 1)
}
