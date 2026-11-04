/**
 * The UI gallery (`bun run gallery`; ARCHITECTURE.md §10, DECISIONS.md D27): every state of the
 * extension's UI on one page per scene, drawn with the real badge, filter, popover and panel code and
 * stylesheets over made-up books, with no extension, network or Audible. `bun run visual` screenshots
 * each scene and compares it with the saved baseline.
 */
import './fake-browser'
import { createStore } from '@tanstack/store'
import { createRoot } from 'react-dom/client'
import { splitShadowRootCss } from 'wxt/utils/split-shadow-root-css'
import logoSvg from '@/assets/brand/logo-small.svg?raw'
import { attachBadges, injectStyles, LABEL, renderCard } from '@/content/badges'
import badgesCss from '@/content/badges.css?inline'
import { type BookView, createBookStore } from '@/content/books'
import { createFilterApplier, type FilterState } from '@/content/filter'
import { createLabelPopover } from '@/content/labels'
import { createOverview } from '@/content/overview'
import overviewCss from '@/content/overview.css?inline'
import { timeout } from '@/content/schedule'
import type { PanelHandle } from '@/content/shared'
import type { FilterSettings } from '@/core/filter'
import { Panel } from '@/panel/Panel'
import panelCss from '@/panel/panel.css?inline'
import {
  DEFAULT_PANEL,
  type PanelState,
  type PanelStorage,
} from '@/storage/panel'
import { DEFAULT_FILTERS, updateFilters } from '@/storage/prefs'
import { READY, SCENES, type SceneId } from './scenes'

const LOGO = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`
/** A fixed clock, so a rate-limit countdown reads the same in every run. */
const NOW = 1_800_000_000_000
const stage = document.getElementById('stage') as HTMLElement

// ---------- books ----------

interface Book {
  readonly asin: string
  readonly title: string
  readonly author: string
  readonly colour: string
  readonly view: BookView
}

const rating = (r: number, n: number, loose = false) => ({
  r,
  n,
  url: 'https://www.goodreads.com/book/show/1',
  loose,
})
const details = (genres: string[], year: number) => ({
  genres,
  year,
  desc: 'Ryland Grace is the sole survivor on a desperate, last-chance mission, and if he fails, humanity and the earth itself will perish. Except that right now, he does not know that. He cannot even remember his own name, let alone the nature of his assignment or how to complete it.',
})

const BOOKS: readonly Book[] = [
  {
    asin: 'B0GALLERY1',
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    colour: '#1e3a8a',
    view: {
      status: 'ready',
      rating: rating(4.52, 412_000),
      details: details(
        ['Science Fiction', 'Fiction', 'Audiobook', 'Space', 'Adventure'],
        2021
      ),
    },
  },
  {
    asin: 'B0GALLERY2',
    title: 'The Silent Lighthouse',
    author: 'Mara Quill',
    colour: '#7c2d12',
    view: {
      status: 'ready',
      rating: rating(4.11, 8_400),
      details: details(['Thriller', 'Horror', 'Mystery', 'Fiction'], 2018),
    },
  },
  {
    asin: 'B0GALLERY3',
    title: 'Notes on Small Gardens',
    author: 'Ivo Brandt',
    colour: '#166534',
    view: {
      status: 'ready',
      rating: rating(3.42, 1_250),
      details: details(['Nonfiction', 'Gardening', 'Memoir'], 2015),
    },
  },
  {
    asin: 'B0GALLERY4',
    title: 'Saltwater Kings',
    author: 'Ines Ortega',
    colour: '#0e7490',
    view: {
      status: 'ready',
      rating: rating(4.05, 22_000, true),
      details: details(['Historical Fiction', 'Fantasy', 'Adventure'], -200),
    },
  },
  {
    asin: 'B0GALLERY5',
    title: 'A Book Goodreads Does Not Know',
    author: 'Anon',
    colour: '#6b21a8',
    view: { status: 'notFound' },
  },
  {
    asin: 'B0GALLERY6',
    title: 'Still Looking This One Up',
    author: 'Pat Lee',
    colour: '#a16207',
    view: { status: 'loading' },
  },
  {
    asin: 'B0GALLERY7',
    title: 'The Lookup That Failed',
    author: 'Sam Roe',
    colour: '#be123c',
    view: {
      status: 'failed',
      error: { reason: 'httpError', message: 'HTTP 503' },
    },
  },
  {
    asin: 'B0GALLERY8',
    title: 'Orbit of Glass',
    author: 'Lena Vos',
    colour: '#334155',
    view: {
      status: 'ready',
      rating: rating(4.38, 56_000),
      details: details(['Science Fiction', 'Space Opera', 'Fiction'], 2023),
    },
  },
]

/** A cover served from Amazon's `/images/I/` path, as the extension finds covers; drawn, not fetched. */
function cover(book: Book): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${book.colour}"/><text x="50" y="54" fill="#fff" font-family="system-ui" font-size="9" text-anchor="middle">${book.title.split(' ').slice(0, 3).join(' ')}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}#/images/I/${book.asin}`
}

/** Settings that show every mark at once: a highlighted genre, a dimmed hidden genre and rating. */
const SETTINGS: FilterSettings = {
  ...DEFAULT_FILTERS,
  minRating: 3.8,
  minRatings: 0,
  hiddenLabels: ['Horror'],
  highlightLabels: ['Science Fiction'],
  modes: { ...DEFAULT_FILTERS.modes, rating: 'dim', labels: 'dim' },
}

/** Lays out books as search results or carousel slides, with badges, labels and the filter marks. */
function drawCards(
  books: readonly Book[],
  layout: 'results' | 'carousel',
  settings: FilterSettings = SETTINGS
): Map<string, Element> {
  injectStyles(document, badgesCss)
  const list = document.createElement(layout === 'results' ? 'ul' : 'div')
  list.className = layout
  const cards = new Map<string, Element>()
  for (const book of books) {
    const card = document.createElement(layout === 'results' ? 'li' : 'div')
    card.className = layout === 'results' ? 'productListItem' : 'slide'
    const href = `/pd/${book.title.replaceAll(' ', '-')}/${book.asin}`
    card.innerHTML =
      layout === 'results'
        ? `<img alt="${book.title} Audiobook By ${book.author} cover art"><div><h3><a></a></h3><span class="by">By: ${book.author}</span></div>`
        : `<a><img alt="${book.title} cover art"></a><a class="title"></a>`
    for (const a of card.querySelectorAll('a')) a.href = href
    const title = card.querySelector('h3 a') ?? card.querySelector('a.title')
    if (title) title.textContent = book.title
    card.querySelector('img')?.setAttribute('src', cover(book))
    list.appendChild(card)
    attachBadges(card, book.asin, book.title)
    renderCard(card, book.view, { onRetry: () => {} })
    cards.set(book.asin, card)
  }
  stage.appendChild(list)
  const byAsin = new Map(
    [...cards].map(([asin, card]) => [asin, new Set([card])])
  )
  const applier = createFilterApplier({
    doc: document,
    region: 'UK',
    cards: () => byAsin,
    viewOf: asin => books.find(b => b.asin === asin)?.view,
  })
  applier.setSettings(settings)
  return cards
}

const labelPill = (card: Element | undefined, genre: string) =>
  [...(card?.querySelectorAll(`.${LABEL}`) ?? [])].find(
    pill => pill.textContent === genre
  ) as HTMLElement

function labelPopover(settings: FilterSettings) {
  return createLabelPopover({
    doc: document,
    css: overviewCss,
    logo: LOGO,
    schedule: timeout,
    hiddenLabels: () => settings.hiddenLabels,
    highlightLabels: () => settings.highlightLabels,
    filtersEnabled: () => settings.enabled,
    booksWith: () => 3,
    hide: () => Promise.resolve(),
    highlight: () => Promise.resolve(),
    release: () => Promise.resolve(),
  })
}

// ---------- the panel ----------

function memoryStorage(initial: Partial<PanelState>): PanelStorage {
  let state: PanelState = { ...DEFAULT_PANEL, ...initial }
  return {
    read: async () => state,
    update: async change => {
      state = {
        ...state,
        ...(typeof change === 'function' ? change(state) : change),
      }
    },
    watch: () => () => {},
  }
}

/** The panel in a shadow root of its own, as the panel script mounts it, over a page of books. */
function drawPanel(options: {
  stored?: Partial<PanelState>
  filter?: Partial<FilterState>
  pausedUntil?: number
}): ShadowRoot {
  const books = createBookStore()
  for (const book of BOOKS) books.set(book.asin, book.view)
  books.setProgress({
    queued: 9,
    active: 3,
    done: 48,
    cached: 30,
    notFound: 2,
    failed: 1,
    ...(options.pausedUntil !== undefined && {
      pausedUntil: options.pausedUntil,
    }),
  })
  const filter = createStore<FilterState>({
    hidden: 12,
    dimmed: 3,
    highlighted: 4,
    peek: false,
    ...options.filter,
  })
  const handle: PanelHandle = {
    state: books.state,
    filter,
    retryFailed: () => {},
    setPeek: peek => filter.setState(prev => ({ ...prev, peek })),
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  // As WXT's createShadowRootUi does: `@property` rules apply only in the document, so Tailwind's
  // need to be there, and the rest goes in the shadow root.
  const { documentCss, shadowCss } = splitShadowRootCss(panelCss)
  const pageStyle = document.createElement('style')
  pageStyle.textContent = documentCss
  document.head.appendChild(pageStyle)
  const style = document.createElement('style')
  style.textContent = shadowCss
  const container = document.createElement('div')
  root.append(style, container)
  createRoot(container).render(
    <Panel
      handle={handle}
      clock={() => NOW}
      storage={memoryStorage(options.stored ?? {})}
      host='www.audible.co.uk'
      logoSrc={LOGO}
      openOptions={() => {}}
    />
  )
  return root
}

/** Waits until `find` returns an element, checking once a frame, for two seconds at most. */
async function until<T>(find: () => T | null | undefined): Promise<T> {
  for (let i = 0; i < 120; i++) {
    const found = find()
    if (found) return found
    await new Promise(requestAnimationFrame)
  }
  throw new Error('The scene did not finish drawing')
}

const button = (root: ShadowRoot, name: string) => () =>
  [...root.querySelectorAll('button')].find(
    b => b.textContent === name || b.getAttribute('aria-label') === name
  )

/** The filter settings as a user who has set a few of them has them. */
const FILTER_PREFS = {
  ...SETTINGS,
  minRating: 4,
  minRatings: 50,
  maxYear: 2020,
  maxPrice: { UK: 10 },
  modes: { ...SETTINGS.modes, count: 'dim', year: 'dim' },
} as const

// ---------- the scenes ----------

const draw: Record<SceneId, () => Promise<void>> = {
  async cards() {
    drawCards(BOOKS, 'results')
  },
  async carousel() {
    drawCards(
      BOOKS.filter(b => b.view.status === 'ready'),
      'carousel'
    )
  },
  async overview() {
    const cards = drawCards(BOOKS.slice(0, 4), 'results')
    const [book] = BOOKS
    const badge = cards.get(book?.asin ?? '')?.querySelector('.agx-badge')
    if (badge && book)
      createOverview({
        doc: document,
        css: overviewCss,
        logo: LOGO,
        viewOf: () => book.view,
      }).show(badge, book.view)
  },
  async 'label-show'() {
    const cards = drawCards(BOOKS.slice(0, 4), 'results')
    labelPopover({ ...SETTINGS, enabled: false }).show(
      labelPill(cards.get('B0GALLERY1'), 'Space')
    )
  },
  async 'label-hidden'() {
    const settings = { ...SETTINGS, hiddenLabels: ['Horror', 'Space'] }
    const cards = drawCards(BOOKS.slice(0, 4), 'results', settings)
    labelPopover(settings).show(labelPill(cards.get('B0GALLERY1'), 'Space'))
  },
  async 'label-saved'() {
    const cards = drawCards(BOOKS.slice(0, 4), 'results')
    labelPopover(SETTINGS).show(labelPill(cards.get('B0GALLERY1'), 'Adventure'))
    const root = document.querySelector('.agx-label-host')?.shadowRoot
    const highlight = [...(root?.querySelectorAll('.choice label') ?? [])].find(
      l => l.textContent === 'Highlight'
    )
    highlight?.querySelector('input')?.click()
    await until(() => root?.querySelector('.status'))
  },
  async 'label-help'() {
    const cards = drawCards(BOOKS.slice(0, 4), 'results')
    labelPopover(SETTINGS).show(labelPill(cards.get('B0GALLERY1'), 'Space'))
    const root = document.querySelector('.agx-label-host')?.shadowRoot
    root?.querySelector<HTMLButtonElement>('button.info')?.click()
  },
  async panel() {
    drawCards(BOOKS, 'results')
    const root = drawPanel({})
    await until(button(root, 'Filter settings'))
  },
  async 'panel-filters'() {
    await updateFilters(FILTER_PREFS)
    const root = drawPanel({ stored: { corner: 'topRight' } })
    ;(await until(button(root, 'Filter settings'))).click()
    await until(() => root.querySelector('[role="slider"]'))
  },
  async 'panel-info'() {
    await updateFilters(FILTER_PREFS)
    const root = drawPanel({ stored: { corner: 'topRight' } })
    ;(await until(button(root, 'Filter settings'))).click()
    ;(await until(button(root, 'About the maximum price'))).focus()
    await until(() => root.querySelector('[role="tooltip"]'))
  },
  async 'panel-paused'() {
    drawCards(BOOKS, 'results')
    const root = drawPanel({ pausedUntil: NOW + 12_000 })
    await until(() => root.querySelector('[role="status"]'))
  },
  async 'pill-on'() {
    drawCards(BOOKS, 'results')
    const root = drawPanel({ stored: { collapsed: true } })
    await until(() => root.querySelector('button[aria-pressed="true"]'))
  },
  async 'pill-off'() {
    await updateFilters({ enabled: false })
    drawCards(BOOKS, 'results', { ...SETTINGS, enabled: false })
    const root = drawPanel({ stored: { collapsed: true } })
    await until(() => root.querySelector('button[aria-pressed="false"]'))
  },
}

/** Without `?scene=`, an index of the scenes. */
function index() {
  stage.className = 'index'
  stage.innerHTML = '<h1>audible-ex UI gallery</h1>'
  for (const scene of SCENES) {
    const link = document.createElement('a')
    link.href = `?scene=${scene.id}`
    link.textContent = scene.title
    stage.appendChild(link)
  }
}

const id = new URLSearchParams(location.search).get('scene') as SceneId | null
const scene = id ? draw[id] : undefined
;(scene ? scene() : Promise.resolve(index())).then(
  // Two frames, so layout and the panel's first effects have settled before a screenshot.
  () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.documentElement.setAttribute(READY, '')
      )
    ),
  error => {
    stage.textContent = `Scene failed: ${error}`
    document.documentElement.setAttribute(READY, 'error')
  }
)
