import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BrowserContext,
  chromium,
  errors,
  expect,
  type Page,
  test,
  type Worker,
} from 'playwright/test'

// Smoke test against live Audible and Goodreads (`bun e2e`, never in CI: the sites change on their
// own schedule). It loads the built extension into Playwright's bundled Chromium, since branded
// Chrome ignores --load-extension, checks that badges appear on two marketplaces, and writes the
// store's screenshots and promo tile to .output/store (docs/STORE-LISTING.md).
//
// The browser runs in a window, not headless: Goodreads answers 403 to a `HeadlessChrome` user
// agent, and the extension never spoofs one. `ipRedirectOverride` stops Audible sending a visitor
// from elsewhere to their own marketplace.

const ROOT = join(import.meta.dirname, '..')
const EXTENSION = join(ROOT, '.output/chrome-mv3')
const STORE = join(ROOT, '.output/store')
const VIEWPORT = { width: 1280, height: 800 }
/** The part of the extension API the tests call inside its service worker. */
declare const chrome: {
  storage: { sync: { set(items: object): Promise<void> } }
}
/** A rating badge, as opposed to one that is waiting, not found or failed. */
const READY = 'a.agx-badge[href^="https://www.goodreads.com/book/"]'

test.describe.configure({ mode: 'serial', timeout: 120_000 })

let context: BrowserContext
let worker: Worker
let extensionId: string

test.beforeAll(async () => {
  mkdirSync(STORE, { recursive: true })
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
    ],
  })
  worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  extensionId = new URL(worker.url()).host
})

test.afterAll(async () => {
  await context?.close()
})

/** Declines Audible's optional cookies when the banner shows, so it is not in a screenshot. */
async function dismissCookies(page: Page) {
  const decline = page
    .getByRole('button', { name: /continue without accepting/i })
    .or(page.locator('#sp-cc-rejectall-link'))
    .first()
  try {
    await decline.waitFor({ state: 'visible', timeout: 5_000 })
  } catch (error) {
    // No banner: the marketplace or a stored choice skipped it.
    if (error instanceof errors.TimeoutError) return
    throw error
  }
  await decline.click()
}

/**
 * Opens an Audible page and waits for `min` visible rating badges. Audible renders some cards
 * twice with one copy hidden, so only visible badges count.
 */
async function openWithBadges(url: string, min: number) {
  const page = await context.newPage()
  const target = new URL(url)
  target.searchParams.set('ipRedirectOverride', 'true')
  await page.goto(target.href)
  expect(new URL(page.url()).origin).toBe(target.origin)
  await dismissCookies(page)
  const ready = page.locator(READY).filter({ visible: true })
  await expect
    .poll(() => ready.count(), { timeout: 90_000 })
    .toBeGreaterThanOrEqual(min)
  // Every badge links to its Goodreads source (AGENTS.md, non-negotiables).
  for (const href of await page
    .locator('a.agx-badge[href]')
    .evaluateAll(links => links.map(a => (a as HTMLAnchorElement).href)))
    expect(href).toMatch(/^https:\/\/www\.goodreads\.com\//)
  return { page, ready }
}

/** Scrolls the first book with a rating near the top: Audible's header and banners fill the view. */
async function scrollToBooks(page: Page) {
  await page
    .locator(READY)
    .filter({ visible: true })
    .first()
    .evaluate(badge =>
      window.scrollBy(0, badge.getBoundingClientRect().top - 60)
    )
  await page.waitForTimeout(500)
}

/**
 * Replaces the prefs with these filters; every other filter and pref takes its default when read
 * (src/storage/prefs.ts). `prefs$` is WXT's version record for the item.
 */
async function setFilters(filters: Record<string, unknown>) {
  await worker.evaluate(
    filters =>
      chrome.storage.sync.set({ prefs: { filters }, prefs$: { v: 6 } }),
    filters
  )
}

// Search and book pages on audible.com answer with an error page outside the US, so .com is
// checked on its home page and the screenshots come from .co.uk.
test('badges appear on audible.com', async () => {
  const { page } = await openWithBadges('https://www.audible.com/', 1)
  await page.close()
})

test('badges, labels and the overview appear on audible.co.uk; store screenshots', async () => {
  // The default filters hide books rated below 4.0; this page should show every badge.
  await setFilters({ enabled: false })
  const { page, ready } = await openWithBadges(
    'https://www.audible.co.uk/search?keywords=Andy%20Weir',
    3
  )
  // Years and labels arrive after the rating; the screenshot is better with them.
  await expect
    .poll(() => page.locator('.agx-year').filter({ visible: true }).count(), {
      timeout: 60_000,
    })
    .toBeGreaterThanOrEqual(2)
  await scrollToBooks(page)
  await page.screenshot({ path: join(STORE, 'screenshot-1-search.png') })

  // The floating panel is a second content script that gets the badge script's state through the
  // isolated world they share (DECISIONS.md D19); if that did not work, nothing mounts. Playwright
  // looks inside open shadow roots.
  await expect(page.locator('agx-panel')).toBeAttached()
  const bar = page.getByRole('progressbar', { name: 'Ratings looked up' })
  await expect(bar).toBeVisible()
  await expect(bar).toHaveAttribute('aria-valuenow', /^[1-9]\d*$/)
  await page.screenshot({ path: join(STORE, 'panel-progress.png') })

  await ready.first().hover()
  await expect(page.locator('.agx-overview-host')).toBeAttached()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(STORE, 'screenshot-2-overview.png') })
  await page.close()
})

test('filters dim books and a highlighted genre outlines them; store screenshot', async () => {
  // Dim rather than hide, so the screenshot shows what the filters do, with a minimum rating most
  // books on the page reach, so it shows passing, dimmed and highlighted books together.
  const filters = {
    minRating: 3.8,
    modes: {
      rating: 'dim',
      count: 'dim',
      labels: 'dim',
      year: 'dim',
      price: 'dim',
    },
  }
  await setFilters(filters)
  const { page } = await openWithBadges(
    'https://www.audible.co.uk/search?keywords=time%20travel',
    3
  )
  const labels = page.locator('.agx-label').filter({ visible: true })
  await expect
    .poll(() => labels.count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(4)
  // Highlight the commonest genre that some cards on the page lack. Open pages apply a prefs change
  // at once; a label's own popover does the same, but hovering it is flaky while cards load.
  const names = await labels.allTextContents()
  const tally = new Map<string, number>()
  for (const name of names) tally.set(name, (tally.get(name) ?? 0) + 1)
  const cards = await page.locator(READY).filter({ visible: true }).count()
  const [label] = [...tally]
    .filter(([, n]) => n < cards)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
  expect(label).toBeDefined()
  await setFilters({ ...filters, highlightLabels: [label] })
  await expect(page.locator('[data-agx-highlight]').first()).toBeAttached()
  await scrollToBooks(page)

  await page.getByRole('button', { name: 'Filter settings' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(STORE, 'screenshot-3-filters.png') })
  await page.close()
})

test('the cache inspector in the settings; store screenshot', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await page.getByRole('button', { name: 'Open cache inspector' }).click()
  // The books the earlier tests looked up.
  await expect(page.getByText(/^[1-9]\d* of \d+ cached books$/)).toBeVisible()
  await page
    .getByRole('heading', { name: 'Cached books' })
    .evaluate(h => window.scrollBy(0, h.getBoundingClientRect().top - 24))
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(STORE, 'screenshot-4-cache.png') })
  await page.close()
})

test('the popup, framed for a store screenshot', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await expect(page.getByText('Not affiliated with Audible')).toBeVisible()
  // The real cache answers: the background takes the popup in a tab as one of its own pages.
  await expect(page.getByText(/books? cached|The cache is empty/)).toBeVisible()
  await page.addStyleTag({
    content: `
      html, body { height: 100%; margin: 0 }
      body { display: flex; align-items: center; justify-content: center;
             background: linear-gradient(135deg, #e8eaf6, #fff8e1) }
      main { background: white; border-radius: 12px; zoom: 1.6;
             box-shadow: 0 10px 30px rgb(0 0 0 / 0.15) }`,
  })
  await page.screenshot({ path: join(STORE, 'screenshot-5-popup.png') })
  await page.close()
})

test('the small promo tile', async () => {
  const logo = readFileSync(join(ROOT, 'src/assets/brand/logo.svg'), 'utf8')
  const page = await context.newPage()
  await page.setViewportSize({ width: 440, height: 280 })
  await page.setContent(`
    <body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:20px;
                 padding:0 28px;box-sizing:border-box;font-family:system-ui,sans-serif;
                 background:linear-gradient(135deg,#1e2a78,#2f3fa8);color:white">
      <div style="width:120px;height:120px;flex:none;background:white;border-radius:24px;
                  display:flex;align-items:center;justify-content:center">
        <div style="width:100px;height:100px">${logo}</div>
      </div>
      <div>
        <div style="font-size:30px;font-weight:700;line-height:1.1">Book Ratings<br>for Audible</div>
        <div style="margin-top:10px;font-size:15px;opacity:.85">Goodreads ratings on Audible</div>
      </div>
    </body>`)
  await page.locator('svg').evaluate(svg => {
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
  })
  await page.screenshot({ path: join(STORE, 'promo-small.png') })
  await page.close()
})
