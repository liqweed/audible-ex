# Plan — audible-ex

Status: 2026-10-29. Replaces the earlier 12-week plan. What and why:
[PRD.md](PRD.md). How: [ARCHITECTURE.md](ARCHITECTURE.md). Decisions already
made: [DECISIONS.md](DECISIONS.md).

## Approach

The userscript in [`reference/`](../reference/audible-goodreads-ratings.user.js)
already does the core job and is in daily use. The plan is to **port it first,
then add features**: reach parity in the extension, then add the floating panel,
progress and filters on top (DECISIONS.md D1). Most of the earlier plan's
infrastructure milestones (HTTP client, Goodreads search, parsing, cache keys,
DOM observation) are covered by the port.

Each phase ends with something usable in Chrome, `bun check` green in CI and a
tagged build.

Sizes are rough: S ≈ a day, M ≈ 2–4 days, L ≈ a week.

## Phase 0 — Toolchain, CI and skeleton (M)

Move the repo to the new stack and prove every piece works together before
porting logic.

Toolchain

- [ ] `mise.toml` pins Bun (1.4.x) and Node (24, fallback runtime for WXT/Vite);
      `packageManager` in `package.json` names the same Bun.
- [ ] Bun: delete `package-lock.json`, `bun install`, commit `bun.lock`.
- [ ] Dependencies. Add `effect`, `@tanstack/react-store`, `@tanstack/pacer` (or
      `@tanstack/react-pacer`), `@happy-dom/global-registrator`, `@biomejs/biome`.
      Remove `vitest`, `@vitest/*`, `jsdom`, `zustand`, `@tanstack/react-query`,
      ESLint and Prettier with their plugins and configs. Upgrade `typescript` to
      7 and `vite` to 8. Pin exact versions.
- [ ] WXT config: `srcDir: 'src'`, `imports: false`, explicit manifest (name,
      version from `package.json`, permissions, host permissions generated from
      the region table). Rename the package from `wxt-react-starter`. Move
      `assets/` and `public/` under `src/` with the entrypoints, and update
      `scripts/gen-icons.ts` and AGENTS.md "Derived files" to match
      (`src/assets/icon.png` stays on Conductor's icon list).
- [ ] Delete the scaffold the design replaces: `src/stores/`,
      `src/lib/{api,hooks,query-client}.ts`, `vitest.config.ts`,
      `src/test/setup.ts`, `DomainDetector`. Port the domain detector's test
      cases to `src/core/regions.test.ts` against `regionFromHost()`.
- [ ] Tests: `bunfig.toml` with `preload = ["./test/preload.ts"]` (happy-dom,
      fake browser as `globalThis.browser`/`chrome`). Confirm the `@/` alias
      resolves under `bun test`.
- [ ] Biome: `biome.json` with `noRestrictedImports` banning the `effect` barrel
      in content-script and UI code and the modules they share (`src/schema`,
      `src/storage`).
- [ ] Scripts: `dev`, `build`, `zip`, `test`, `lint`, `format`, `check`,
      `e2e` (ARCHITECTURE.md §13), and `typecheck`, which runs
      `wxt prepare && effect-tsgo tsc --noEmit` (D14).

CI and Jig (see [CI](#ci) below)

- [ ] `.github/workflows/ci.yml` as described under [CI](#ci).
- [ ] `.config/jig.yaml`: `gates.command: bun check` and `ci.required_checks`
      naming the CI job, in the same pull request as the workflow.
- [ ] Create the GitHub labels `label-taxonomy.yaml` defines, then file the plan
      as issues with `/jig:file-issue`: one `epic` per phase, one issue per task.
      Close #3–#13 as superseded by D1, each pointing at its replacement.
- [ ] Renovate for dependency and action updates, grouped weekly, pinned
      versions only (D12).

Spikes, each a short note in the pull request (issue #18; the notes are on the issue and the
settled choices are in DECISIONS.md D13 and D14)

- [x] Effect `ManagedRuntime` in the MV3 service worker: survives a worker
      restart; the port reconnects. Natural idle stop still to check without a
      debugger attached (ARCHITECTURE.md §4).
- [x] Goodreads `auto_complete` and book page work from the background with
      `credentials: 'omit'`. One `202` empty response seen; to be handled as a
      rate-limit signal (ARCHITECTURE.md §4).
- [x] `api.audible.*/1.0/catalog/products` works from the background without
      cookies, on all 10 hosts; ASINs are marketplace-specific.
- [x] IndexedDB: `idb` behind `BookCache` (D13), not `@effect/platform-browser`.
- [x] `bun --bun wxt` for the dev server too: starts and rebuilds on change;
      hot reload in a real browser not checked.
- [x] Effect language service with TypeScript 7: `@effect/tsgo` works (D14).

Fixtures and docs

- [x] `scripts/capture-fixtures.ts` and the first fixtures: search, category,
      deals and home on `.co.uk` and `.com`; Goodreads autocomplete and book
      page responses for 20 books, including known tricky matches (series
      titles, "summary" books, common titles). See `test/fixtures/README.md`.
- [ ] Library and wish list fixtures on `.co.uk` and `.com`: saved by hand from
      a signed-in browser and cleaned with `capture-fixtures.ts import`
      (steps in `test/fixtures/README.md`). Needed before phase 1's card tests
      for those two pages. Done except `.com` library: that account has no
      titles, so it waits for one that has.
- [ ] `AGENTS.md`: drop the "phase 0 has not started" status, make the gate and
      command sections current.

Exit: `bun check` and `bun run build` pass in CI; an empty extension loads on
Audible and the background answers a `Hello` over the port.

## Phase 1 — Parity with the userscript (L)

The extension does everything userscript v2.4.0 does, on all 10 marketplaces.

- [x] `src/core`: `text.ts` (`norm`, `shortTitle`, `lastName`), `matching.ts`
      (scoring and candidate choice), `asin.ts`, `regions.ts`. Tests from
      fixtures.
- [x] `src/schema`: Goodreads autocomplete, `__NEXT_DATA__` book extraction,
      Audible catalog response, cache records, port messages.
- [x] Background services: `AudibleCatalog` (batched with `RequestResolver`),
      `Goodreads`, `BookCache` (time limits, pins, daily purge), `LookupQueue`
      (dedupe, 3 workers, 250 ms gap, two priorities, 429/503 backoff, circuit
      breaker), `PortServer`. Test layers and `TestClock` tests for expiry,
      backoff and dedupe.
- [x] Content script: scanner, card detection, IntersectionObserver, badge
      placement and rendering, labels and year, retry on failure. DOM tests per
      page type from fixtures (library and wish list: `.co.uk` and the `.com`
      wish list; the `.com` library awaits a fixture, see Phase 0).
- [x] Hover overview rendered in a shadow root (prepares the panel's mount
      point), capped at 600 characters.
- [x] Popup: enable/disable, cache stats, clear unpinned / clear all (replaces
      the userscript's menu commands).
- [x] CI: content-script size budget (see [CI](#ci)).
- [ ] One-time migration is **not** planned: userscript data lives in the
      userscript manager and the extension can't read it. Users switching over
      refetch once.

Exit: side by side with the userscript on the six fixture page types, the
extension shows the same ratings, labels and years; two open Audible tabs share
one queue. Release 0.1.

## Phase 2 — Floating panel and progress (M)

- [x] `ProgressHub` in the background; `Progress` messages per tab.
- [x] TanStack Store for `books` and `progress` in the content script.
- [x] Panel in a shadow root (`createShadowRootUi`), React + Tailwind + Radix:
      drag to a corner, collapse to a pill, hide on this site; placement saved in
      `storage.local`; show again from the popup.
- [x] Progress: bar and counters, rate-limit pause with countdown, "Retry
      failed", and a distinct "page format changed" error. (The panel is a
      second content script, D19.)
- [x] Component tests for each panel state: progress, docked corner, drag,
      collapsed and hidden.

Exit: on a deals page with 60+ books the panel shows progress to completion;
collapsing, moving and hiding survive a reload. Release 0.2.

## Phase 3 — Filters (M, then S)

3a. Rating, count and labels

- [x] `sync:prefs` storage item with version and migrations; Schema defaults
      (ARCHITECTURE.md §8).
- [x] `src/core/filter.ts` verdicts (ARCHITECTURE.md §7), fully unit-tested.
- [x] Filter applier: derived verdict store → `data-agx-filter` attributes;
      CSS hide/dim. (`src/content/filter.ts`: it recomputes all cards on each
      change instead of keeping a derived store.)
- [x] Carousel detection from fixtures; carousels dim instead of hide.
- [x] Panel controls: master switch, rating slider (default 4.0,
      Pacer-debounced), minimum ratings, hidden-labels picker with autocomplete
      from the genres of the books on the page, not-found policy, hide/dim mode.
- [x] `12 hidden · Show` counter and peek.
- [x] Label pills: hovering or focusing one opens a popover to hide books with
      that label, or to stop; a label that is filtered on is struck through.
- [x] Changes in one tab apply in all open Audible tabs (storage watch).

Release 0.3.

3c. Panel follow-ups (prefs v6, DECISIONS.md D25)

- [x] Hide or dim per filter (`modes`), with a compact Hide/Dim choice on each
      filter's row; narrower year and price fields.
- [x] Highlighted labels: outlined cards and marked pills, from the panel and
      the label popover; independent of the filters' switch.
- [x] `i` explanations instead of help paragraphs; a settings button that
      opens the options page (`OpenOptions`).
- [x] The pill shows and toggles filtering, and counts the hidden and dimmed
      cards.

3b. Price and year

- [x] Public `catalog/products` prices verified without signing in on `.co.uk`
      and `.com` (2026-11-03); `AudibleCatalog` reads the `price` response group.
      Saved responses: `test/fixtures/audible/{uk,com}/catalog-price.json`.
- [x] First-published year range: inclusive optional bounds in the panel,
      synced across tabs; missing years stay visible unless another filter applies.
- [x] `maxPrice` per region: optional inclusive public cash-price ceiling in the
      panel, in the marketplace currency, synced across tabs. Blank is off; 0 is
      free only. Prices are fetched for visible cards while a limit is active,
      independently of cached ratings; missing prices stay visible unless
      another filter applies. Public prices can differ from member offers.

Exit: preferences survive browser restart and sync to a second Chrome profile
signed into the same account; filtering never hides a card whose data hasn't
loaded.

## Phase 4 — Options page (M)

- [x] Settings with TanStack Form: all prefs, display options (label count,
      year, overview), reset to defaults, export/import prefs as JSON. Display
      edits update open Audible tabs; backups contain prefs only, with validation
      and confirmation before import or reset.
- [x] Cache inspector with TanStack Table + Virtual: search, sort by
      rating/age, delete entries, open on Goodreads, correct a wrong match by
      pasting a Goodreads URL (stored as a manual override that the cache purge
      keeps).
- [x] About: privacy statement, "not affiliated" notice, source link.
- [x] Settings page redesign: logo, one Display section with a preview of a
      book that follows the unsaved draft (including the hover overview), a
      bar of unsaved changes fixed to the window's bottom, steppers and a
      slider on numbers, hidden and highlighted labels as removable pills with
      an autocompleting picker fed by the genres of cached books
      (`ListGenres`), Hide/Dim switches in one list, the year range last, one
      price table with currency signs, keyboard order through the fields only,
      the cache's state as a bar, and the project links at the bottom. The
      popup has the logo, the same bar and an icon on every button, and opens
      the options page at its Cache section.
- [x] Pins record the list they were seen on (`library` or `wishlist`) and the
      cache counts each; older pins have none until the book is seen again.

Release 0.4 (with 3b).

## Phase 5 — Publish (M)

Publishing moved forward (DECISIONS.md D17): release 0.1, phase 1's parity
build, goes to the Chrome Web Store unlisted and switches to public after a week
of use without reported breakage. Each later release updates the same listing.

Release 0.1 (unlisted)

- [x] Name and icon that use neither Audible/Amazon/Goodreads logos nor their
      trade dress: **Book Ratings for Audible**, checked against existing
      listings.
- [x] Privacy policy: [PRIVACY.md](../PRIVACY.md), linked from the popup.
- [x] Store listing text, single purpose statement, permission justifications
      and privacy disclosures: [STORE-LISTING.md](STORE-LISTING.md). The popup
      carries the "not affiliated" line until the options page does.
- [x] Playwright smoke run on live `.co.uk` and `.com` (`bun e2e`), which also
      writes the screenshots and promo tile.
- [x] Make the repository public, with its history rewritten first (the removed
      `.claude/` prompts and the branch names of earlier pull requests name
      another project), and a ruleset on `main` requiring the CI job.
- [x] Cut release 0.1.0 by hand (`changes/README.md`), `bun zip`, register the
      developer account and upload as unlisted (STORE-LISTING.md, "Submitting a
      release by hand"). Submitted 2026-11-02 as item `kmmnfidbflcgfcbifjfakgnjppoflffo`.
- [x] After approval, install from the store link and check badges on two
      marketplaces.
- [x] Switch the listing to public after a week of use without reported
      breakage.

Afterwards, before 1.0

- [x] Finish the changelog setup (`/jig:changelog setup`, DECISIONS.md D26):
      the release App `audible-ex-release`, the `changelog-release`
      environment, the rulesets and `.github/workflows/changelog.yml`. Merging
      a pull request with a change note releases it (`changes/README.md`).
- [x] Release workflow (see [CI](#ci), DECISIONS.md D20): on a version tag,
      build both zips and attach them to a GitHub release, then sign the Chrome
      build and submit it to the store. `release.yml` is written; the one-time
      setup (environments, Google Workload Identity, variables) is in
      STORE-LISTING.md, "Automated releases".
- [ ] Add an AI reviewer (CodeRabbit is free for public repositories) and set
      `review.*` in `.config/jig.yaml`, so `/jig:drive-pr` can run review
      rounds unattended.
- [ ] Firefox on addons.mozilla.org (DECISIONS.md D29): the manifest's
      Firefox settings and the build steps for reviewers are done; the first
      submission is by hand (`docs/AMO-LISTING.md`), then `release.yml`
      submits each release to AMO too.

## Later

- Hardcover as a second rating source (official API). Shown alongside, and used
  when Goodreads fails or blocks requests.
- Series detection and order.
- Duration and narrator filters.
- Rating distribution on hover (needs the book page's histogram; check it's in
  `__NEXT_DATA__`).
- Library and Wish List marks: a badge mark for a book the user owns or has
  wish-listed, and later the personal collections it is in. Pins already
  record whether an ASIN was last seen in the Library or the Wish List (the
  `list` of the pin, taken from the page the tab is on); what is left is
  collections (`collection:<id>`) and sending the place back on `BookUpdate`.
  Collection names come from the collections page. The extension only knows
  what the user has scrolled past on those pages, so the feature needs a
  visible "last seen in your Library on …" and a prompt to page through the
  Library once; a background prescan would fetch `www.audible.*` pages with
  the user's cookies, a new host permission and a privacy change (§11), and is
  not planned. Removal is unknowable until the page is seen again without it,
  so the mark expires with the pin.
- Settings page follow-ups, in the order worth doing them:
  - Warn before leaving the page with unsaved changes (`beforeunload`), now
    that a bar says there are some.
  - Show the filters in the preview: a few sample books that are hidden or
    dimmed, with the reason, and a price chip, using `judge` and `failures`
    from `src/core/filter.ts` (a first version was drawn and dropped as too
    much beside the Display settings; put it under Filters if it comes back).
  - Gallery scenes and baselines for the options page and the popup
    (`test/gallery`, D27); today only the page-side UI is covered, and the
    settings page was checked by hand in a browser.
  - Keep the genre suggestions for longer than the cache keeps the books: a
    store of genres seen (a database upgrade), since `ListGenres` reads the
    stored details, which the daily purge shrinks to Library and Wish List
    books plus the last month.
  - Marketplace flags beside the currency signs, if a font or an image set
    renders them on every platform (regional-indicator emoji show as letters
    on Windows).
  - Steppers on the year and price fields, with a step per currency (1, but
    100 for yen and rupees), if people ask; the rating fields have them.
- Staged publishing (DECISIONS.md D21): `publishType: STAGED_PUBLISH` in
  `scripts/upload-cws.ts`, so an approved version waits for one click in the
  dashboard before users get it. Decide when the listing is public.

## CI

`.github/workflows/ci.yml` (added in phase 0, after the toolchain move, because
a workflow for the old npm/Vitest scaffold would have been thrown away within
days) runs on `pull_request` and `push` to `main`:

- One job, **`Extension — check, build`**, on `ubuntu-latest`:
  `actions/checkout` → `jdx/mise-action` (installs the pinned Bun and Node,
  cached) → `bun install --frozen-lockfile` → `bun check` → `bun run build` →
  upload `.output/chrome-mv3` as an artifact.
- `permissions: contents: read`; `concurrency` per ref, cancelling superseded
  pull request runs but never a run on `main`; `timeout-minutes: 15` on the
  job; the artifact is kept for 7 days.
- Actions pinned by commit SHA with the version in a comment; Renovate updates
  them (the setup is #17). `/jig:github-actions` reviews every workflow change.
- No path filters: the job is required, and a filtered required check never
  reports.
- Required check: GitHub doesn't offer rulesets for a private repository on the
  free plan, so the job name goes into `ci.required_checks` in
  `.config/jig.yaml` (as in pointsman). Once the repository is public (phase 5),
  add a ruleset on `main` requiring the job.

Added later:

| Phase | Addition                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------------- |
| 1     | Content-script size budget: `scripts/check-content-size.ts` fails when `content-scripts/content.js` passes 50 KB gzipped (set from a 36 KB build). |
| 2     | The same script also fails when `content-scripts/panel.js` passes 120 KB gzipped (a 64 KB build; raised in phase 3 for the Schema-decoded prefs and the Radix filter controls, 104.7 KB). |
| 1     | `bun run build` for Firefox as a second step, so a Chrome-only API is caught early.                                  |
| 5     | `release.yml` on `v*` tags: gate, build, attach the Chrome and Firefox zips to a GitHub release, sign the CRX and submit it to the store (D20). |
| 5     | `changelog.yml`: Jig's change-note check on PRs (job `check`, required); after each merge, the release commit and, once CI passes on it, its `v*` tag (D26). |
| Later | Nightly (not per-PR) Playwright smoke run against live Audible, reporting to an issue on failure.                    |

End-to-end tests against live sites never gate a pull request: the sites change
on their own schedule.

## Defaults to confirm

Chosen so work can proceed; each is a one-line change.

| Setting                      | Default                        | Alternative                                                  |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Minimum rating               | 4.0, slider 3.0–5.0            | Wider 1.0–5.0 range                                          |
| Minimum number of ratings    | 50                             | 0 (off), or 100                                              |
| Filtered cards               | Hidden (dimmed in carousels)   | Dimmed everywhere                                            |
| Books not found on Goodreads | Shown                          | Dimmed                                                       |
| Genre details                | Fetched for every visible book | Only on hover or when a label filter is set (fewer requests) |
| Overview on hover            | On, 600 characters             | Off                                                          |

## Risks

| Risk                                                        | Likelihood | Impact | Response                                                                                                                               |
| ----------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Amazon/Goodreads object to the extension (terms of service) | Low–medium | High   | Free, no server, link back, conservative rate, no data export. If asked to remove it, comply; the userscript remains for personal use. |
| Goodreads changes its page format or autocomplete           | Medium     | Medium | Schemas turn changes into a visible "format changed" error; fixtures make the fix quick; Hardcover as fallback.                        |
| Goodreads adds bot protection                               | Low–medium | High   | Backoff and circuit breaker avoid hammering; Hardcover fallback.                                                                       |
| Audible changes its markup                                  | High       | Medium | Card detection is structural (links to one ASIN), not selector-based; fixture tests per page type.                                     |
| Bun runtime incompatibility in WXT's dev server             | Low        | Low    | Phase 0 spike; fall back to Node for WXT only.                                                                                         |
| Store review rejects or delays the listing                  | Medium     | Low    | Narrow permissions, clear privacy disclosure, unlisted first.                                                                          |
