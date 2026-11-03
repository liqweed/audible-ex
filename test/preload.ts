/**
 * Loaded before every test file (bunfig.toml). Gives tests a DOM (happy-dom) and WXT's in-memory
 * fake browser, and registers `fake-indexeddb` globally: `idb` looks up `IDBDatabase` and friends as
 * globals, as they are in a service worker. `BookCache` tests still pass each test its own
 * `IDBFactory`. `@wxt-dev/storage` reads `browser` from `@wxt-dev/browser`, which takes it from the
 * globals, so the globals must be set here; mocking `wxt/browser` alone isn't enough (AGENTS.md).
 */
import { afterEach } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import 'fake-indexeddb/auto'
import { fakeBrowser } from 'wxt/testing/fake-browser'

GlobalRegistrator.register()

Object.assign(globalThis, { browser: fakeBrowser, chrome: fakeBrowser })

/**
 * Bun runs every test file in one process, so one happy-dom document is shared by all of them. A
 * test that loads an Audible fixture leaves its page behind, and a later file querying Testing
 * Library's `screen` by role (`alert`, `link`) then finds the fixture's elements too. Emptying
 * the body after each test keeps the files independent of the order they run in.
 */
afterEach(() => {
  document.body.replaceChildren()
  for (const { name } of [...document.body.attributes])
    document.body.removeAttribute(name)
})
