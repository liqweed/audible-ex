import { expect, test } from 'bun:test'
import {
  FakeFilters,
  loadBody,
  ready,
  startWorld,
} from '../../test/content-harness'
import { DEFAULT_DISPLAY, type DisplaySettings } from '../core/display'
import { DEFAULT_FILTERS } from '../storage/prefs'
import { OVERVIEW_HOST } from './cards'

const book = () =>
  loadBody(
    '<main><article><h3><a href="/pd/Book/B000000001">Book</a></h3></article></main>'
  )
const flush = () => Promise.resolve()

test('display edits redraw loaded badges and close the overview without changing data or lookups', async () => {
  book()
  let notify = (_settings: DisplaySettings) => {}
  let stopped = false
  const world = startWorld({
    display: {
      read: async () => DEFAULT_DISPLAY,
      watch: cb => {
        notify = cb
        return () => {
          stopped = true
        }
      },
    },
    filters: new FakeFilters({ ...DEFAULT_FILTERS, hiddenLabels: ['Fantasy'] }),
  })
  await flush()
  world.io.intersect()
  world.port.receive(
    ready(
      'B000000001',
      { r: 4.5, n: 100 },
      { genres: ['Fantasy', 'History', 'Romance'], year: 2000, desc: 'A book.' }
    )
  )
  const badge = document.querySelector('.agx-badge') as HTMLElement
  expect(document.querySelectorAll('.agx-label')).toHaveLength(3)
  expect(document.querySelector('.agx-year')?.textContent).toBe('2000')
  badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(
    document
      .querySelector(`.${OVERVIEW_HOST}`)
      ?.shadowRoot?.querySelector('.tip')
  ).toBeTruthy()
  const originalLabel = document.querySelector('.agx-label')
  notify(DEFAULT_DISPLAY)
  expect(document.querySelector('.agx-label')).toBe(originalLabel)
  const messages = world.port.sent.length
  notify({ labels: 0, year: false, overview: false })
  expect(document.querySelectorAll('.agx-label')).toHaveLength(0)
  expect(document.querySelector('.agx-year')).toBeNull()
  expect(
    document
      .querySelector(`.${OVERVIEW_HOST}`)
      ?.shadowRoot?.querySelector('.tip')
  ).toBeNull()
  expect(badge.title).toContain('Goodreads')
  badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(
    document
      .querySelector(`.${OVERVIEW_HOST}`)
      ?.shadowRoot?.querySelector('.tip')
  ).toBeNull()
  // The hidden-label filter still uses the book's genres even though the labels are not drawn.
  expect(document.querySelector('[data-agx-filter="hide"]')).toBeTruthy()
  expect(world.content?.books.get('B000000001')?.details?.genres).toHaveLength(
    3
  )
  notify({ labels: 1, year: false, overview: true })
  expect(document.querySelectorAll('.agx-label')).toHaveLength(1)
  badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  expect(
    document
      .querySelector(`.${OVERVIEW_HOST}`)
      ?.shadowRoot?.querySelector('.tip')?.textContent
  ).not.toContain('first published')
  expect(world.port.sent.length).toBe(messages)
  world.content?.remove()
  expect(stopped).toBe(true)
})

test('the watched display wins over a stale first read', async () => {
  book()
  let finish = (_value: DisplaySettings) => {}
  let notify = (_value: DisplaySettings) => {}
  const world = startWorld({
    display: {
      read: () =>
        new Promise(resolve => {
          finish = resolve
        }),
      watch: cb => {
        notify = cb
        return () => {}
      },
    },
  })
  world.io.intersect()
  world.port.receive(
    ready('B000000001', { r: 4.5, n: 100 }, { genres: ['Fantasy'], year: 2000 })
  )
  notify({ labels: 0, year: false, overview: false })
  finish(DEFAULT_DISPLAY)
  await flush()
  expect(document.querySelectorAll('.agx-label')).toHaveLength(0)
  world.content?.remove()
  finish(DEFAULT_DISPLAY)
  await flush()
  expect(document.querySelectorAll('.agx-wrap')).toHaveLength(0)
})

test('a late display read cannot redraw after stop', async () => {
  book()
  let finish = (_value: DisplaySettings) => {}
  const world = startWorld({
    display: {
      read: () =>
        new Promise(resolve => {
          finish = resolve
        }),
      watch: () => () => {},
    },
  })
  world.io.intersect()
  world.port.receive(
    ready('B000000001', { r: 4.5, n: 100 }, { genres: ['Fantasy'], year: 2000 })
  )
  world.content?.stop()
  finish({ labels: 0, year: false, overview: false })
  await flush()
  expect(document.querySelectorAll('.agx-label')).toHaveLength(1)
})
