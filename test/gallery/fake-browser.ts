// Imported first: the prefs storage reads `browser` when it loads, and the gallery has no extension.
import { fakeBrowser } from 'wxt/testing/fake-browser'

Object.assign(globalThis, { browser: fakeBrowser, chrome: fakeBrowser })
