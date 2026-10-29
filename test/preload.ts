/**
 * Loaded before every test file (bunfig.toml). Gives tests a DOM (happy-dom) and WXT's in-memory
 * fake browser, and registers `fake-indexeddb` globally: `idb` looks up `IDBDatabase` and friends as
 * globals, as they are in a service worker. `BookCache` tests still pass each test its own
 * `IDBFactory`. `@wxt-dev/storage` reads `browser` from `@wxt-dev/browser`, which takes it from the
 * globals, so the globals must be set here; mocking `wxt/browser` alone isn't enough (AGENTS.md).
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import 'fake-indexeddb/auto'
import { fakeBrowser } from 'wxt/testing/fake-browser'

GlobalRegistrator.register()

Object.assign(globalThis, { browser: fakeBrowser, chrome: fakeBrowser })
