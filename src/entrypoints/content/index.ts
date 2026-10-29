import { defineContentScript } from 'wxt/utils/define-content-script'
import { contentScriptMatches } from '@/core/regions'

// Empty shell; the scanner, badges and panel arrive in phase 1 (ARCHITECTURE.md §6).
export default defineContentScript({
  matches: contentScriptMatches(),
  allFrames: false,
  main() {},
})
