# Working agreements — audible-ex

audible-ex is a personal open-source project by Ophir Radnitz (MIT): a Chrome MV3
extension that shows Goodreads ratings, genres and years on Audible book cards,
with a floating panel for lookup progress and personal filters. This file is for
anyone (human or agent) changing the repository; `CLAUDE.md` is a symlink to it.

Read before changing code: [docs/PRD.md](docs/PRD.md) (what and why),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how),
[docs/PLAN.md](docs/PLAN.md) (phases and order),
[docs/DECISIONS.md](docs/DECISIONS.md) (decisions already made),
[GLOSSARY.md](GLOSSARY.md) (the words to use). The behaviour reference is the
userscript in [reference/](reference/audible-goodreads-ratings.user.js).

## Status

Design and plan are agreed. Phase 0's toolchain is in place: Bun, WXT with
`srcDir: 'src'`, `bun test`, Biome and TypeScript 7; `bun check` and
`bun run build` work. CI runs both on every pull request and on pushes to
`main` (`.github/workflows/ci.yml`, one job, `Extension — check, build`); Jig
reads the gate from `gates.command` and the required check from
`ci.required_checks` in `.config/jig.yaml`. The background worker serves the `agx`
port (`LookupQueue`, `PortServer`) and the content script finds cards, shows badges
and the hover overview (`src/content/`); the popup has the on/off switch and the
cache size and clearing. The floating panel (its own content script, D19) has
progress, drag/collapse/hide controls, filters and marketplace public-price limits.
The options page edits all prefs, controls badge display and imports/exports
prefs-only backups; the cache inspector searches/sorts/deletes local books and corrects matches
through the shared queue ([D24](docs/DECISIONS.md#d24--cache-inspector-and-persistent-manual-matches-2026-11-04)). TanStack Form
stays in the options entrypoint ([D22](docs/DECISIONS.md#d22--tanstack-form-for-the-options-settings-2026-11-03)).

## Non-negotiables

- **Local only.** No server, no analytics, no telemetry, no remote config, no
  remote code. Network access is limited to `www.goodreads.com` and the
  `api.audible.*` catalogue hosts, from the background worker only.
- **Respect the sources.** Every Goodreads request goes through the background
  `LookupQueue` (3 workers, 250 ms gap, backoff on 429/503); never fetch
  Goodreads from a content script or bypass the cache. Goodreads requests send
  no cookies (`credentials: 'omit'`). No user-agent spoofing, no rotation.
- **Every badge links to its Goodreads source.** No rating data is exported.
- **No new dependency without a decision** in `docs/DECISIONS.md`.
- **Effect imports by path** (`effect/Schema`), never from the `effect` barrel,
  in content-script and UI code (bundle size; ARCHITECTURE.md §6).
- **Prefs live in `chrome.storage`** through WXT `storage`, never in
  `localStorage` (in a content script that is Audible's own storage).
- **Bun first.** `bun install`, `bun test`, `bun run`; versions pinned in
  `mise.toml`. TypeScript strict.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`,
  `refactor:`, `test:`). Small branches and PRs; CI green before merge; a person
  merges.

## Gates

From phase 0 on, one command runs every gate, in this order, and CI runs the
same command on every pull request:

```sh
bun check   # biome ci → effect-tsgo tsc --noEmit → bun test
bun run build   # wxt build; also run it when you touch wxt.config.ts or entrypoints
bun scripts/check-content-size.ts   # after the build: gzipped size budgets of content.js (50 KB) and panel.js (120 KB)
```

Run these yourself before pushing; CI repeats them (and builds Firefox) and uploads the unpacked
extension (`.output/chrome-mv3`) as an artifact for loading in Chrome.
Merging a pull request with a change note releases it: `.github/workflows/changelog.yml`
pushes the release commit to `main` as the release App and tags it once CI passes
(DECISIONS.md D26). A `v*` tag on `main` runs `.github/workflows/release.yml`, which signs the build and
submits it to the Chrome Web Store (DECISIONS.md D20). Biome doesn't check Markdown (DECISIONS.md D4): keep docs tidy by review.

## Guardrails

| Failure it prevents                                | Rule                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Hammering Goodreads, getting the extension blocked | All lookups through `LookupQueue` and `BookCache`; no new request paths without review   |
| Hiding a book before its data arrives (page jumps) | Filter verdict is `show` for any book not `ready` (`src/core/filter.ts`)                 |
| Breaking Audible carousels                         | Cards in carousels are dimmed, never hidden                                              |
| A content script that slows every Audible page     | `content.js` imports only `effect/Schema` from Effect and no React; React lives in `panel.content` (D19) |
| Store rejection or takedown                        | No new permission or host without updating ARCHITECTURE.md §11 and the privacy statement |
| Settings lost or split per region                  | Prefs only in `storage.sync` via the `sync:prefs` item, with a version and migrations    |

## Verified facts — do not re-litigate

- Under `bun test`, `@wxt-dev/storage` reads `browser` from `@wxt-dev/browser`;
  set `globalThis.browser`/`chrome` to `wxt/testing/fake-browser` in the preload
  (mocking `wxt/browser` alone fails).
- `bun --bun wxt build` builds with WXT 0.21 and Vite 8.
- Bundle cost (measured 2026-10-29, Bun bundler, minified + gzip): a
  Schema-only module via `effect/Schema` ≈ 23 KB; via the `effect` barrel ≈ 97 KB.
- In Effect 4, join a fiber with `Fiber.join(fiber)`; `TestClock` is in
  `effect/testing`.
- Branded Chrome 137+ ignores `--load-extension`, so Playwright must use its
  bundled Chromium (or another Chromium build) to load the unpacked extension.
- `@effect/tsgo` replaces `@effect/language-service` under TypeScript 7; the
  `typecheck` script runs `effect-tsgo tsc --noEmit` (DECISIONS.md D14).
- Goodreads answers 403 to a `HeadlessChrome` user agent (checked 2026-11-02),
  so `bun e2e` runs Chromium in a window; real browsers get 200. Outside the
  US, `audible.com` search and book pages show an error page even with
  `ipRedirectOverride=true`; its home page works.
- Goodreads has no API for new developers (closed 2020); the extension uses
  `book/auto_complete?format=json` and the book page's `__NEXT_DATA__` JSON.

## Commands (from phase 0)

```sh
mise install && bun install   # toolchain, then dependencies
bun dev                       # WXT dev server, Chrome, hot reload
bun run build                 # production build (.output/chrome-mv3)
bun zip                       # store upload zip
bun crx                       # signed store upload (key from 1Password; docs/STORE-LISTING.md)
bun test src/core/matching.test.ts   # one test file
bun e2e                       # Playwright smoke test on live Audible (manual)
bun scripts/capture-fixtures.ts      # refresh Audible/Goodreads fixtures
```

## Change together

| When you change                                 | Also change, in the same commit                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A port message                                  | `src/schema/messages.ts`, both sides, a test, ARCHITECTURE.md §5                         |
| A `chrome.storage` item or the prefs shape      | `src/storage/`, a migration (bump `version`), ARCHITECTURE.md §8                         |
| Permissions, host permissions or `matches`      | `src/core/regions.ts`, ARCHITECTURE.md §11, the privacy statement                        |
| Matching rules (`src/core/matching.ts`)         | A fixture case for the book that motivated it                                            |
| Filter semantics (`src/core/filter.ts`)         | ARCHITECTURE.md §7 and PRD R3                                                            |
| A dependency                                    | An entry in `docs/DECISIONS.md` first                                                    |
| A job name in `.github/workflows/ci.yml`        | `ci.required_checks` in `.config/jig.yaml`                                               |
| The `name:` of `.github/workflows/ci.yml`       | `workflow_run.workflows` in `.github/workflows/changelog.yml`                            |
| A phase's scope or order                        | `docs/PLAN.md`                                                                           |
| Anything a user of the extension notices        | A change note in `changes/` (`/jig:changelog`); never edit `CHANGELOG.md` or the version |
| What ships (`release_paths`)                    | `changelog.release_paths` in `.config/jig.yaml`                                          |
| `src/assets/brand/logo.svg` or `logo-small.svg` | Run `bun scripts/gen-icons.ts` and commit every output (see Derived files)               |

## Derived files

Generated, committed, and never edited by hand; change the source and
regenerate.

| Files                                                             | Source                            | Regenerate                 |
| ----------------------------------------------------------------- | --------------------------------- | -------------------------- |
| `src/public/icon/{16,32,48,96,128}.png` (extension icons)         | `src/assets/brand/logo*.svg`      | `bun scripts/gen-icons.ts` |
| `src/assets/icon.png` (Conductor's repository icon)               | `src/assets/brand/logo.svg`       | `bun scripts/gen-icons.ts` |
| `.idea/icon.svg`, `.idea/icon_dark.svg` (IntelliJ's project icon) | `src/assets/brand/logo-small.svg` | `bun scripts/gen-icons.ts` |
| `CHANGELOG.md` sections and the `package.json` version            | `changes/*.md`                    | Jig's release step         |

Conductor picks the first of a fixed list of paths (its FAQ);
`src/assets/icon.png` is on it. IntelliJ reads `.idea/icon.svg` and
`.idea/icon_dark.svg`.

## Working with Jig

The repository uses [Jig](https://github.com/jig-harness/jig) skills; its
values are in `.config/jig.yaml`. Useful here: `/jig:file-issue` to file plan
tasks, `/jig:do-item` to pick one up, `/jig:review` before opening a pull
request, `/jig:decide` for a design dilemma (record the outcome in
`docs/DECISIONS.md`), `/jig:changelog` to write a change note and check it
(`changes/README.md` says which changes need one), `/jig:fix-ci` for a red
run, `/jig:audit` to re-score the repository.

## Scratch files

`.context/` at the repository root (gitignored) is the scratch area for agents
and people: notes, previews, setup pages and scripts, screenshots, and
`/jig:drive-pr`'s handoff (`.context/pr-drive-<PR>.md`). Nothing there is
committed or relied on by the build; never put scratch files elsewhere in the
tree.

## What a terminal cannot verify

Loading the unpacked extension, the panel, badges on live Audible pages and the
popup need a browser. Unless the session has browser control (Playwright),
hand those checks over with exact steps instead of reporting them as verified.
