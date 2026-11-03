import { beforeEach, describe, expect, test } from 'bun:test'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { exportPrefs } from '@/options/settings'
import { DEFAULT_PREFS, readPrefs, updateFilters } from '@/storage/prefs'
import { App } from './App'

beforeEach(() => {
  cleanup()
  fakeBrowser.reset()
})

async function show(download = (_text: string) => {}) {
  await act(async () => {
    render(<App download={download} />)
  })
  await screen.findByRole('button', { name: 'Save settings' })
}
const save = async () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  })
const value = (label: string) =>
  (screen.getByLabelText(label) as HTMLInputElement).value
const change = (label: string, v: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value: v } })

async function upload(text: string) {
  const file = new File([text], 'prefs.json', { type: 'application/json' })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Import prefs from JSON'), {
      target: { files: [file] },
    })
  })
}

describe('options settings', () => {
  test('loads defaults and saves display, filters and marketplace prices together', async () => {
    await show()
    expect(value('Minimum rating')).toBe('4')
    expect(value('Labels per book')).toBe('3')
    change('Labels per book', '0')
    fireEvent.click(screen.getByLabelText('Show overview on hover'))
    change('From year', '-800')
    change('To year', '-700')
    change('audible.co.uk (GBP)', '0')
    change('Hidden labels', 'Fantasy\nHistory, Politics')
    expect((await readPrefs()).display.labels).toBe(3)
    await save()
    await screen.findByText('Settings saved.')
    expect((await readPrefs()).display).toEqual({
      labels: 0,
      year: true,
      overview: false,
    })
    expect((await readPrefs()).filters).toMatchObject({
      minYear: -800,
      maxYear: -700,
      maxPrice: { UK: 0 },
      hiddenLabels: ['Fantasy', 'History, Politics'],
    })
  })
  test('invalid years and prices leave storage untouched and can be corrected', async () => {
    await show()
    change('From year', '2020')
    change('To year', '2000')
    await save()
    await screen.findByRole('alert')
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
    change('To year', '2021')
    change('audible.com (USD)', '-1')
    await save()
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
    change('audible.com (USD)', '15.5')
    await save()
    await screen.findByText('Settings saved.')
    expect((await readPrefs()).filters.maxPrice).toEqual({ US: 15.5 })
  })
  test('follows external changes when clean and preserves a draft while dirty', async () => {
    await show()
    await act(() => updateFilters({ minRating: 4.5 }))
    await waitFor(() => expect(value('Minimum rating')).toBe('4.5'))
    change('Labels per book', '1')
    await act(() => updateFilters({ minRating: 3.5, maxPrice: { US: 20 } }))
    expect(value('Labels per book')).toBe('1')
    expect(screen.getByText(/Settings changed in another tab/)).toBeTruthy()
    await save()
    await screen.findByText('Settings saved.')
    expect((await readPrefs()).filters.minRating).toBe(3.5)
    expect((await readPrefs()).display.labels).toBe(1)
    expect(value('Minimum rating')).toBe('3.5')
  })
  test('discard reloads saved prefs without writing the draft', async () => {
    await show()
    change('Minimum rating', '5')
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(value('Minimum rating')).toBe('4')
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
  })
  test('reset is confirmed, can be cancelled and preserves device-local panel state', async () => {
    await updateFilters({ minRating: 5 })
    await fakeBrowser.storage.local.set({ panel: { corner: 'topLeft' } })
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults…' }))
    expect((await readPrefs()).filters.minRating).toBe(5)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((await readPrefs()).filters.minRating).toBe(5)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset preferences' }))
    await screen.findByText('Preferences reset to defaults.')
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
    expect((await fakeBrowser.storage.local.get('panel')).panel).toEqual({
      corner: 'topLeft',
    })
  })
  test('exports saved prefs and imports only after confirmation', async () => {
    const exported: string[] = []
    await show(text => exported.push(text))
    change('Minimum rating', '5')
    fireEvent.click(
      screen.getByRole('button', { name: 'Export prefs as JSON' })
    )
    await screen.findByText('Saved preferences exported.')
    expect(JSON.parse(exported[0] ?? '').prefs.filters.minRating).toBe(4)
    await upload(exportPrefs({ ...DEFAULT_PREFS, enabled: false }))
    await screen.findByRole('button', { name: 'Import preferences' })
    expect((await readPrefs()).enabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Import preferences' }))
    await screen.findByText('Preferences imported.')
    expect((await readPrefs()).enabled).toBe(false)
    expect(value('Minimum rating')).toBe('4')
  })
  test('refuses an invalid backup without changing prefs', async () => {
    await show()
    await upload('{"format":"other"}')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(await readPrefs()).toEqual(DEFAULT_PREFS)
    expect(
      screen.queryByRole('button', { name: 'Import preferences' })
    ).toBeNull()
  })
  test('includes the privacy statement, source and affiliation notice', async () => {
    await show()
    expect(
      screen
        .getByRole('link', { name: 'Privacy statement' })
        .getAttribute('href')
    ).toContain('PRIVACY')
    expect(screen.getByRole('link', { name: 'Source code' })).toBeTruthy()
    expect(
      screen.getByText('Not affiliated with Audible, Amazon or Goodreads.')
    ).toBeTruthy()
  })
  test('a failed storage write keeps the draft and reports the failure', async () => {
    await show()
    change('Minimum rating', '5')
    const original = fakeBrowser.storage.sync.set
    fakeBrowser.storage.sync.set = (() =>
      Promise.reject(new Error('Storage full'))) as typeof original
    try {
      await save()
      expect((await screen.findByRole('alert')).textContent).toContain(
        'Storage full'
      )
      expect(value('Minimum rating')).toBe('5')
    } finally {
      fakeBrowser.storage.sync.set = original
    }
  })
})

test('import errors name unknown fields and invalid values', async () => {
  await show()
  await upload(
    JSON.stringify({
      format: 'audible-ex-prefs',
      version: 1,
      prefs: { unexpectedSetting: true },
    })
  )
  expect((await screen.findByRole('alert')).textContent).toContain(
    'unexpectedSetting'
  )
  await upload(
    JSON.stringify({
      format: 'audible-ex-prefs',
      version: 1,
      prefs: { filters: { minRating: 9 } },
    })
  )
  expect((await screen.findByRole('alert')).textContent).toContain('minRating')
  expect(await readPrefs()).toEqual(DEFAULT_PREFS)
})
