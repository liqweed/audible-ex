# Decisions

One paragraph per non-obvious decision: what was decided, why, and what was
rejected. Newest last. Change a decision by adding a new entry that supersedes
the old one, never by editing it.

## D1 — Port the userscript instead of building from the old specs (2026-10-29)

The extension starts by porting `reference/audible-goodreads-ratings.user.js`
v2.4.0: card detection, Goodreads matching, caching rules and badge placement.
The userscript is in daily use and its selectors and matching rules encode
lessons (title-only search first to avoid "summary" books, popover handling,
library row selectors) that the earlier infrastructure-first plan and issues
#3–#13 didn't have. Rejected: implementing those issues from their specs.

## D2 — Stack: Bun, WXT on Vite, Effect, TanStack (2026-10-29)

Bun is the package manager, script runner and test runner; WXT 0.21 (on Vite 8)
builds the extension; Effect 4 runs the background worker; TanStack Store,
Pacer, Form, Table and Virtual cover UI state, UI timing and the options page;
React 19, Tailwind 4 and Radix remain for UI. Verified before deciding:
`bun --bun wxt build` works; `bun test` runs WXT storage on the fake browser,
happy-dom DOM tests and Effect's `TestClock`. Removed: Vitest and jsdom (one
test runner), Zustand (it persisted to the page's `localStorage`), TanStack
Query (data is pushed from the background; Effect already caches and retries).
Not adopted yet: TanStack Router and DB, Effect Atom and RPC.

## D3 — Effect in the background only; Schema everywhere (2026-10-29)

Concurrency, retries, batching and typed errors all live in the background
worker, so that is where Effect is used. The content script runs on every
Audible page and imports only `effect/Schema` for message codecs, by path:
measured, a Schema-only module costs ≈ 23 KB gzipped by path and ≈ 97 KB through
the `effect` barrel. Badges are plain DOM; only the panel is React.

## D4 — Biome replaces ESLint and Prettier (2026-10-29)

One fast tool for lint and format, as in the owner's other repositories
(pointsman, Jig). Its `noRestrictedImports` rule enforces D3's import rule.
Markdown, which Biome doesn't format, is kept tidy by review. Rejected: keeping
ESLint + Prettier (two tools, slower, plugin setup under Bun).

## D5 — Storage split: prefs in sync, cache in IndexedDB (2026-10-29)

Prefs go to `storage.sync` (one versioned WXT item) so they follow the user
across devices and marketplaces; panel placement goes to `storage.local`
(device-specific); the cache goes to IndexedDB in the background (thousands of
records, purged by timestamp). The cache is keyed by ASIN and Goodreads book
id, not by region. Cache time limits are the userscript's (30 days found, 7
days not found, pins 180 days), replacing the earlier "1,000 books, 7 days, LRU,
per region".

## D6 — All 10 marketplaces in v1 (2026-10-29)

The userscript already supports `.com .co.uk .ca .com.au .in .de .fr .it .es
.co.jp`; one region table generates matches and host permissions. Non-English
matching is labelled best effort. Rejected: UK-only MVP.

## D7 — MIT licence (2026-10-29)

The code is MIT, like the owner's other personal projects. A permissive licence
suits a small browser extension, lets the userscript community reuse the
matching logic, and keeps the Chrome Web Store listing simple. The licence
covers the code only: it grants no rights to the Audible, Amazon or Goodreads
names, and our own name and icon stay ours to protect separately if needed.
Rejected: Apache-2.0 (its patent grant matters little here, and it is more to
carry for a one-person project), GPL/AGPL (copyleft would discourage reuse in
userscripts and doesn't stop the case we'd worry about, a monetised clone,
since a store clone can comply by publishing source).

## D8 — Jig at Solo/Lite (2026-10-29)

The repository adopts Jig's Solo/Lite profile: `AGENTS.md` as the single
instruction file (`CLAUDE.md` links to it), `GLOSSARY.md`, a documented gate set
run by CI (phase 0), and `.config/jig.yaml`. The earlier `.claude/` agents,
commands, workflows and session logs were removed: they were written for
another project (they named another product and Next.js 14 and pinned retired models),
and Jig's skills (`do-item`, `review`, `file-issue`, `decide`) replace them.
A label taxonomy (`label-taxonomy.yaml`) is added now, ahead of the profile,
because the next step files the plan as issues with `/jig:file-issue`, and the
repository's file must override the taxonomy set in the owner's
machine-wide Jig config. The changelog follows in D10; other Team/Standard
practices (separate ADR files) are added when they pay off.

## D9 — Request rate: the userscript's, plus backoff (2026-10-29)

At most 3 Goodreads requests in flight, 250 ms between requests per worker, one
queue for all tabs; on 429 or 503 the whole queue pauses with exponential
backoff (5 s to 2 min, honouring `Retry-After`) and a circuit breaker stops
traffic after repeated failures. The userscript's rate has worked in daily use;
the backoff covers what it lacked. Rejected: the earlier "1 request per second"
(slower with no evidence it's needed) and user-configurable delays (a setting
nobody can tune well).

## D10 — Changelog from change notes, release automation later (2026-10-29)

Superseded in part by D26: the repository is public, and the release App and
workflow are set up.

The changelog is kept with Jig's changelog skill, in Keep a Changelog format:
each pull request a user would notice adds a note in `changes/`, and the release
step writes the notes into `CHANGELOG.md` and moves the version in
`package.json`, which WXT copies into the manifest. A note is required when a
change touches what ships (`changes/README.md` says what gets one). The release
App and workflow are left out for now: they keep the App's key fenced to `main`
with rulesets and a protected environment, which GitHub Free doesn't offer on a
private repository. Until the repository is public (PLAN.md phase 5), a person
cuts releases by hand. Rejected: waiting until phase 5 to start (the notes for
0.1–0.4 would have to be reconstructed), upgrading to GitHub Pro for this alone.

## D11 — Toolchain details settled while moving to Bun (2026-10-29)

Moving the scaffold to the D2 stack (issue #15) needed four choices D2 didn't
name. `@types/bun` is added: TypeScript 7 includes no type packages by default,
and `tsc` can't type `bun:test` without it. Tailwind moves from
`@tailwindcss/postcss` to `@tailwindcss/vite`, configured in `wxt.config.ts` as
§2 of ARCHITECTURE.md says, and to 4.3, the first Tailwind 4 release whose Vite
plugin supports Vite 8; `postcss.config.js`, `autoprefixer` and
`tailwind.config.ts` go, since Tailwind 4 reads its theme from CSS. TanStack
Pacer is the core `@tanstack/pacer`: its main use is batching the content
script's rescans, which is plain DOM code; `@tanstack/react-pacer` is added only
if its hooks prove worth it in the panel. `@types/chrome` is dropped, since WXT
supplies the browser types. Rejected: keeping PostCSS (a second plugin path
beside Vite's) and adding `react-pacer` up front.

## D12 — Renovate keeps pins current (2026-10-29)

Dependencies, the tools in `mise.toml` and the GitHub Actions in the workflow
are all pinned exactly, so something has to propose updates or they go stale
unseen. Renovate (`.github/renovate.json5`, the Mend Renovate GitHub App) opens
one pull request a week per kind of update (npm, mise tools, Actions digests),
and a separate one for WXT, Effect and Vite, which need a manual browser check
before merging; Bun's three pins move together; major versions get their own
pull requests; there is no lock file refresh. Commits are `chore(deps)`, nothing
automerges, and a person merges as for any other change. It is a service, not a
dependency of the repository, and does nothing until the Mend Renovate GitHub
App is installed on the repository. Rejected: Dependabot, which
has no `mise.toml` support and so would leave the toolchain pins unmanaged.

## D13 — IndexedDB through `idb` behind `BookCache`, not `@effect/platform-browser` (2026-10-29)

The cache (ARCHITECTURE.md §8) uses `idb` 8, a thin promise wrapper over
IndexedDB, behind the `BookCache` service. The phase 0 spike (issue #18)
prototyped both options on the hard case, an index on a timestamp and a
range delete for the daily purge, and both worked. `@effect/platform-browser`'s
`IndexedDb` modules give Schema-typed tables and typed errors, but every one of
them is marked `@stability unstable`, and the cache is the one component that
holds data users would lose if the API moved. The cost of `idb` is a few dozen
lines that decode with Schema and map failures to tagged errors; bundle size
(1.5 KB against about 9 KB gzip in the worker) was not a factor. Because
`BookCache` is an interface, switching later touches one file. A worker has no
`window`, so anyone trying `@effect/platform-browser` later must build its
`IndexedDb` service from `self.indexedDB`, not use `layerWindow`. `idb` is added
as a dependency in phase 1, with `BookCache`. Rejected: `@effect/platform-browser`
for now (unstable API on user data), raw IndexedDB (verbose transaction and
cursor code with no gain).

## D14 — `@effect/tsgo` for Effect diagnostics under TypeScript 7 (2026-10-29)

`@effect/tsgo` 0.63.0 is added as a dev dependency, pinned. The older
`@effect/language-service` is a tsserver plugin that TypeScript 7's native
compiler does not load; its README points TypeScript 7 users to `@effect/tsgo`,
whose supported list includes the repository's 7.0.2. `tsconfig.json` enables
the plugin, and the `typecheck` script runs `effect-tsgo tsc --noEmit`, which
runs the same type check plus Effect's diagnostics (for example a floating
Effect that is never yielded) and exits non-zero on an error. Verified on this
repository: a clean tree passes and an unyielded `Effect.log` fails with
`TS377001`. It runs on Bun without patching `node_modules`. Rejected:
skipping the language service (Effect mistakes such as a forgotten `yield*` are
silent at runtime), and `@effect/language-service` (does not run on TypeScript 7).

## D15 — `fake-indexeddb` for the `BookCache` tests (2026-10-29)

`fake-indexeddb` 6.2.6 is added as a dev dependency, pinned. The cache tests
need a real IndexedDB: the index on a timestamp, the cursor walk and the
single-transaction purge are the code that can go wrong, and the acceptance
criterion "the cache survives a worker restart" can only be proven by closing
the database and opening it again over the same data. `fake-indexeddb` is a
complete in-memory implementation of the IndexedDB API. `idb` checks its
arguments against the `IDBDatabase` family of globals, so the test preload
imports `fake-indexeddb/auto`, which registers them (and a global `indexedDB`
that no `BookCache` code reads). Every test still gets a fresh `IDBFactory` and
passes it to the live layer, so tests share no state. Rejected: an in-memory test layer only (fast, but it
proves neither persistence nor the transaction and index code, which is what
the live layer is made of), and running a browser for these tests (slow, manual,
and not something CI does on every push).

## D16 — Effect's HTTP client for the network services, though it is marked unstable (2026-10-29)

`AudibleCatalog` and `Goodreads` make their requests with `HttpClient` and
`FetchHttpClient` from `effect/http` (ARCHITECTURE.md §4). Every module of
`effect/http` is labelled `@stability unstable`, so `@effect/tsgo` warns on each
use (`unstableApiUsage`) and the warning fails `bun check`; the three files that
use it (`httpGet.ts`, `AudibleCatalog.ts`, `Goodreads.ts`, plus the test helper
`HttpTest.ts`) turn that one diagnostic off with a file-level comment, so
nothing else is silenced. Unlike D13's cache this holds no user data: a changed
API breaks a request at compile time and is fixed in `httpGet.ts`, the only
place that calls `execute`. Effect is pinned exactly and Renovate proposes its
updates in a pull request of their own (D12), so a break shows up before a
release. The same choice makes the tests honest: they fake `fetch` under the
real client, so they see the URL, the `Accept` header and `credentials: 'omit'`
as the browser would. Rejected: calling `fetch` directly (no typed errors or
test seam for free, and the credentials rule would be easy to lose in one call
site), and turning `unstableApiUsage` off for the whole repository (it would
hide the next unstable import in code that holds data).

## D17 — Publish 0.1 to the Chrome Web Store, unlisted, before phases 2–4 (2026-11-02)

The store listing moves from the end of the plan (release 1.0, after the panel,
filters and options page) to release 0.1: phase 1 already does what the
userscript does, and getting through store review, the privacy disclosures and
real use early is worth more than a feature-complete first listing. 0.1 is
published unlisted and goes public after a week without reported breakage; later
releases update the same listing. The extension is named **Book Ratings for
Audible**: descriptive, findable, and free of Goodreads' trademark (the closest
existing listing, "Goodreads ratings for Amazon", uses it). Until the options
page exists, the popup carries the "not affiliated" line and links to the
privacy policy, which is `PRIVACY.md` in the repository rather than a GitHub
Pages site: the store only needs a public URL, and one file is simpler to keep
in step. The listing text lives in `docs/STORE-LISTING.md` so it is reviewed with
the code it describes, and the listing claims only what has shipped (the
manifest's description no longer mentions filters). Rejected: waiting for 1.0
(months without real users or store feedback), and publishing publicly at once
(unlisted first was the plan's safeguard against a broken first impression).

## D18 — Verified CRX uploads, with the signing key in 1Password (2026-11-02)

The Chrome Web Store item opts in to Verified CRX uploads: the store rejects
any package not signed with the project's RSA key, so taking over the developer
account is not enough to push an update to users, which is how malicious
updates of other extensions have shipped. The 2048-bit private key lives only in
1Password (Private vault); `bun crx` (`scripts/pack-crx.ts`) copies it into a
private temporary directory for the run, checks it against the committed public
key (`.config/cws-signing-key.pub.pem`), packs the build with Chrome's
`--pack-extension` from Playwright's bundled Chromium, verifies the CRX's
signature, and deletes the key. No new dependency: Chrome packs, `node:crypto`
verifies, and the `op` CLI reads 1Password. The cost is that every upload is a
signed CRX and that losing the key blocks updates for up to a week while Web
Store support replaces it. The opt-in happens after 0.1.0's first review and
before the listing goes public. Rejected: staying with Google-signed zips (no
protection against an account takeover); a key file kept on disk or in CI
(easier to leak than to lose); the `crx3` npm package (a dependency for what
Chrome already does).

## D19 — The panel is a second content script, with its own size budget (2026-11-03)

The floating panel (phase 2) is React, and React does not fit the content
script's budget. Measured on 2026-11-03 with Bun's bundler, minified, production
mode, gzipped: React and `react-dom/client` alone 54 KB; with the Radix switch,
slider and tooltip the panel needs 76 KB; `@tanstack/react-store` adds 3 KB. The
content script that draws the badges is 37 KB against a budget of 50 KB
(`scripts/check-content-size.ts`), so a panel inside it would make every Audible
page carry about 113 KB, three times today's. So the panel is its own
entrypoint, `src/entrypoints/panel.content/`, with the same `matches` and
`all_frames: false`. WXT builds it as a separate file (`content-scripts/panel.js`,
193 KB raw in a trial build with one Radix switch) and lists both files in one
manifest entry. Both run on every Audible page; the split keeps `content.js`,
the code that must stay cheap, free of React and keeps the 50 KB budget
meaningful, but it does not make React load lazily. `check-content-size.ts`
gets a second budget for `panel.js`, set from the first real build with room to
grow, and CI keeps failing on either.

The two scripts meet through the isolated world. All of an extension's content
scripts in a frame share one isolated world, so `content.js` publishes its
`BookStore` (D2's TanStack Store, `src/content/books.ts`) on a single property
of `globalThis`, and announces it with an event on `document`; `panel.js` waits
for it and renders nothing until it has the store and there is something to
show. Neither opens a port of its own: a second port would be a second session
with its own `Progress` counters (ARCHITECTURE.md §5). The shared-world
behaviour is documented by Chrome and Firefox but is checked in a browser, not
by `bun test`: the panel's pull request adds a step to `bun e2e` that fails
if the panel does not find the store.

Rejected: injecting the panel on demand with `scripting.executeScript` (a new
permission, against ARCHITECTURE.md §11, for a saving of parse time that was not
measured), and a dynamic `import()` of a chunk listed in
`web_accessible_resources` (any Audible page could then probe for the extension,
and it widens the manifest the store reviews). Also rejected for now: Preact
through `preact/compat` to cut the 54 KB (a new dependency whose compatibility
with Radix would have to be proven, for a cost that is local disk and parse
time, not network), and drawing the panel in plain DOM like the badges (the
filter controls are a slider, switches and a label picker with autocomplete, which
is what Radix is for, and the options page will reuse the components).
Revisit if the panel's parse time shows up in a measurement on a real Audible page;
the first candidate then is `scripting.registerContentScripts` with a permission
decision of its own.

Follow-ups, each in the pull request that needs it: the second budget in
`check-content-size.ts` and `docs/PLAN.md`'s CI table; ARCHITECTURE.md §6 and §12
(the entrypoint and the shared store); the "no React for badges" guardrail in
AGENTS.md, which stays true of `content.js` and gains "the panel is
`panel.content`".

Budget, as built (2026-11-03). `panel.js` was 64 KB gzipped with the progress view,
92 KB once the panel's stored state brought in `effect/Schema` (to decode it, as
every stored record is), and 104.7 KB with the filter controls (Radix switch and
slider, Pacer's debouncer, the label picker). The 100 KB budget became 120 KB in
the pull request that added the controls. Measured against alternatives: a
hand-written debounce saves 3.5 KB; decoding without Schema would save about
23 KB (the measure above) but leave the panel's records unchecked, which the rest of the code base
does not do. The content script stays at 38 KB of 50.

## D20 — A version tag releases to the Chrome Web Store (2026-11-03)

Pushing a `vX.Y.Z` tag on a commit of `main` builds the extension, signs it and
submits it to the store for review, with no manual upload (`release.yml`, PLAN.md
phase 5). A person still decides when: they cut the release commit and push the
tag, and the `chrome-web-store` environment asks for their approval before
anything is uploaded. Store review stays Google's; the version reaches users when
it is approved (`publishType: DEFAULT_PUBLISH`; `STAGED_PUBLISH` would hold an
approved version until someone publishes it).

This supersedes the part of D18 that kept the signing key out of CI. The key now
also lives in an environment secret (`CWS_SIGNING_KEY` in `release-signing`);
1Password stays the master copy and the way to sign by hand. What D18 protects
still holds, with four fences: the secret exists only in the `sign` job, which
has no store access; the store credential is never stored (the `publish` job
exchanges GitHub's OIDC token for a short-lived Google access token through
Workload Identity Federation, so there is no refresh token to leak or expire
after 7 days on an OAuth screen left in testing), and that job has no key and
installs no packages; both environments accept only `v*` tags, and a ruleset
limits who can create them; and `upload-cws.ts` verifies the CRX against the
committed public key before sending it. A leaked store credential alone still
cannot publish, and neither can a leaked tag.

Not `wxt submit`: its Chrome upload sends a zip without the raw-upload headers a
signed CRX needs (publish-browser-extension 6.2.0), so `scripts/upload-cws.ts`
calls the v2 API with `fetch` (about 100 lines, tested with a fake store). The
v1.1 API, which older tools still use, stopped working on 2026-10-15. The one
new dependency is the Action `google-github-actions/auth`, pinned by digest and
kept current by Renovate. The same workflow attaches the Chrome and Firefox zips
to a GitHub release.

Rejected: a long-lived OAuth refresh token or service-account key in secrets
(more to leak, and the first expires weekly while the consent screen is in
testing); signing and uploading in one job (one compromised step would hold both
halves); leaving the key in 1Password only (every release stays a manual step
for the sake of a risk the fences already cover). Not covered: a person with
write access who can push a tag and approve the environment can release; make
sure that is only the owner.

## D21 — No approval step before the store upload (2026-11-03)

D20 had the `chrome-web-store` environment ask the owner to approve each
release before the upload. The first automated release (v0.2.0) showed it adds
little: only the owner can create a `v*` tag (a ruleset), the tag already is the
decision to release, and whoever could misuse the approval could also change the
environment. The environment keeps its tag rule and loses its required
reviewer; pushing the tag now signs, uploads and submits for review without a
second step. The fences of D20 are unchanged, and Google's review still stands
between a release and users. Staged publishing (`STAGED_PUBLISH`, one dashboard
click after the review) is not used; it is the way to put a person's check after
the review instead of before the upload, and is listed in PLAN.md "Later" for
when the listing is public. Rejected: keeping the approval as a safeguard against a
mistaken tag (a tag can be deleted by the owner only, and a bad version is
caught by the review or replaced by the next).


## D22 — TanStack Form for the options settings (2026-11-03)

The options page uses `@tanstack/react-form` 1.33.5, pinned, as D2 planned. It
owns a draft that is validated with the existing prefs Schema and saved on
submit; the panel keeps its live controls. Only dirty fields are merged into
the latest stored prefs, so saving a display change does not overwrite a filter
changed in another tab. External changes refresh a clean form; a dirty form
keeps its draft and offers to reload the saved settings. Display prefs join
`sync:prefs` at version 5 with defaults preserving today's appearance.

JSON export/import is a versioned prefs-only envelope: no cached book data,
ratings or device-local panel state. Invalid or newer-format backups are
refused without changing storage. Import and reset require a second click
after showing what will happen; ordinary Save applies the draft. Rejected:
adding another validator (the shared Schema already owns the constraints),
saving each options field immediately (a half-typed range is not a setting),
and exporting the cache (against R5). Form is imported only by the options
page, keeping both content-script budgets unchanged. These constraints are
covered by storage, options and content-script tests; the repository has no
separate ADR rules catalog (D8).

## D23 — Public catalogue prices for marketplace limits (2026-11-03)

Unauthenticated `catalog/products` requests with the `price` response group
return cash prices: verified without cookies on `.co.uk` (GBP) and `.com`
(USD), with raw responses saved as `test/fixtures/audible/{uk,com}/catalog-price.json`.
Use `price.lowest_price.base` and `currency_code`, rounded to that currency's
fraction digits; never treat `credit_price` as money. These are public prices,
so the panel and options page explain that member offers can differ. Limits
are inclusive and keyed by marketplace, with no currency conversion.

Fetch prices for visible cards while a limit is active, through the existing
background catalogue service and its batcher. Prices stay in page memory and
are independent of the long-lived Goodreads and metadata caches. Missing or
malformed prices and failed price requests leave the rating usable and do not
fail the price filter. Rejected: parsing card text now (the catalogue supplies
a typed currency and amount), persisting prices with metadata (30-day prices
would be stale), and treating an absent price as zero (it could hide a book
for a price we never learned). Fixture, filter and queue tests cover these
constraints; no separate ADR rules catalog is used (D8).

## D24 — Cache inspector and persistent manual matches (2026-11-04)

The options page adds `@tanstack/react-table` 8.21.3 and
`@tanstack/react-virtual` 3.14.26, pinned, as D2 planned. Only the options
entrypoint imports them. It lists local cached books, searches title, author
and ASIN, sorts by rating or saved time, and deletes individual books.

A correction accepts an HTTPS Goodreads book URL, extracts its numeric id and
reads that exact book through the existing `LookupQueue`, with the same pacing,
backoff and circuit breaker as automatic matches. Only a successful, validated
book-page read replaces the match. IndexedDB version 2 adds `overrides`, keyed
by ASIN: the chosen Goodreads id and the time of the correction. Automatic
writes cannot replace a different manual match. Ratings still expire normally;
refreshes read the chosen book instead of searching again. Daily purge and
clear-unpinned keep overrides and their associated entries; delete-book and
clear-all remove them. Deleting shared details keeps them while another cached
rating or override refers to them. Reload an Audible page to see a correction.

Rejected: fetching from options (bypasses the shared queue), treating a correction
as an ordinary cache write (expiry would lose it), and exporting cached ratings
(against R5). Schema, queue and IndexedDB tests enforce these rules. As D8
specifies, this repository has no separate ADR rules catalog.

## D25 — A miss mode per filter, highlighted labels, and the panel's own info popovers (2026-11-04)

Users asked to dim some filters and hide others (a price over the limit is worth
seeing faded; a hidden genre is not), to mark genres they are interested in, and
for a shorter panel.

Prefs v6 replaces `filters.mode` with `filters.modes`, one `hide`/`dim` per
filter (`rating`, `count`, `labels`, `year`, `price`). A book failing several
filters is hidden if any of them hides, so a stricter filter is never softened by
a lenient one. The migration gives every filter the old `mode`; the same upgrade
(`upgradeModes`) runs on decode and on backup import, so the backup envelope
stays at version 1. The not-found policy keeps its three values. Rejected: a
global mode plus per-filter overrides (two places to read for one answer).

Highlighted labels (`filters.highlightLabels`) live beside the hidden labels
because the panel and the label popover edit them together, but they are not a
filter: they never change a verdict and apply with the filters' switch off. A
label is in one list at most; adding it to one removes it from the other.
Highlighted cards get `data-agx-highlight`, and their cover image `data-agx-shine`, a soft amber
glow (first an outline of the whole card, which drew too much attention).

The panel's explanations are a hand-written fixed-position popover (`InfoTip`)
with Lucide's `Info` icon, not `@radix-ui/react-tooltip`, already a dependency:
Radix Tooltip brings its positioning library into `panel.js`, several KB of the
13 KB left in the 120 KB budget (D19) for one feature. With the icons, the
popover, the pill and the per-filter choices, `panel.js` went from 106.4 KB to
109.6 KB gzipped; `content.js` from 40.5 KB to 41.1 KB. Revisit if the panel
needs focus-trapped popovers or collision handling beyond above/below.

The panel opens the options page through a one-off `OpenOptions` message to the
background, which accepts it from content scripts. A link would need
`options.html` in `web_accessible_resources` (rejected in D19), and
`runtime.openOptionsPage` is not available to content scripts.

## D26 — Merging releases: the changelog workflow pushes the release commit and tags it (2026-11-04)

The repository is public, so rulesets and protected environments are available
on GitHub Free and D10's reason for cutting releases by hand is gone.
`.github/workflows/changelog.yml` (Jig's template, pinned to Jig v0.129.2) runs
the branch check on every pull request; after each push to `main` it writes the
waiting notes into `CHANGELOG.md` and moves the version, and a GitHub App,
`audible-ex-release` (Contents write only, no Workflows permission), pushes that
commit straight onto `main` (`release.push: direct`). Once the commit's required
check (`Extension — check, build`, `ci.required_checks`) passes, the workflow
tags it `vX.Y.Z` through the API as the App, and the tag starts `release.yml`
(D20), which publishes without an approval step (D21). The App's tag and push
start other workflows; the workflow's own token would not.

The App's key is the secret `CHANGELOG_APP_PRIVATE_KEY` of the environment
`changelog-release`, which only `main` may deploy to, and only the two jobs that
run nothing from the repository use it. The `main` ruleset lets the App past
(bypass `always`) so it can push without a pull request; a second ruleset blocks
force pushes and deletion of `main` with no bypass for it. The `release tags`
ruleset lets the App create `v*` tags.

Rejected: `release.push: pull-request` (a release pull request a person merges):
one more step per release for a review the change notes already had, against
D21. Revisit if a release ever needs holding back; staged publishing (PLAN.md,
Later) is the store-side alternative.

## D27 — A UI gallery with local visual regression tests (2026-11-04)

UI changes were checked by building one-off preview pages and injecting styles into
live Audible pages, again for each change, and nothing caught a visual regression
(the header of the panel had wrapped since "Retry failed" was added, unnoticed).
`test/gallery/` draws every UI state from the real components and stylesheets over
made-up books, offline; `bun run visual` screenshots each scene with Playwright's
`toHaveScreenshot` and compares it with a committed baseline. No new dependency:
the `playwright` package already has the test runner, and the run uses the full
Chromium `bun e2e` installs, in its new headless mode.

Baselines are per platform (`__screenshots__/<platform>/`), made on the machine that
runs them, and the tests do not run in CI: fonts and anti-aliasing differ between
macOS and Linux, so CI would need Linux baselines that nobody can review locally.
Revisit when the UI changes often enough that a forgotten local run matters; then add
a CI job that compares Linux baselines generated by a manual workflow. The
tolerance is 10 pixels, since one machine renders the same scene identically
(three runs gave no differences); a looser ratio hid a changed button.

The store screenshots stay with `bun e2e` on live Audible, since they must show the
real site; the gallery is for checking the extension's own UI.

## D28 — Eager filtering: fetch no more for a book a hiding filter already hides (2026-11-04)

Every visible book got its Goodreads search and its book page (~400 KB), even when
its public price or its rating already hid it: with the default filters (rating
4.0, hidden) every book under the minimum still had its book page read, for a card
nobody saw.

A filter's failures only grow as data arrives, so a `hide` verdict on what is known
is final. The content script decides how far each book's lookup goes
(`lookupDepth`, `src/core/filter.ts`): nothing while a hiding price limit waits for
the price or once a `hide` filter fails the book, the rating only (`Lookup` with
`ratingOnly`) while a hiding rating or count filter could still hide it, and the
details (`DetailsLookup`) once the rating lets it through. It decides, not the
background, because only it knows where the cards are (carousels dim instead of
hiding) and whether the user peeks. A book that would be seen again (filter off or
dimming, peeking, a new carousel card) is looked up the rest of the way.

For this to hold, the price filter now acts as soon as the price arrives, before
the rating, and on books not on Goodreads too (the stricter of the price and the
not-found policy, instead of the policy winning). Otherwise a book hidden on its
price would be shown again once its lookup said "not found", or never be looked up
to say so. The rule that a book is never hidden for data it does not have stands.

`DetailsLookup` is a message of its own rather than a second `Lookup`, so the
progress counters do not count the book twice. Lookups wait for the filters to be
read, at most 1 s, so the first screen is not looked up in full before the
settings say how far to go. While a hiding price limit waits for a book's price,
the content script asks only what the cache has (`cacheOnly`): a cached rating
costs Goodreads nothing, so it shows at once instead of waiting for the
catalogue's price batch; only uncached books wait for the price. Rejected: sending the thresholds to the
background (it would still need the cards' placement and peeking), and cancelling
queued Goodreads jobs (the queue's work is shared between tabs).

## D29 — Firefox on addons.mozilla.org (2026-11-04)

Every release has built a Firefox zip and a source archive since D20, but nothing
submitted them. The Firefox build now carries what AMO needs, and the first
submission is by hand (`docs/AMO-LISTING.md`).

- **Add-on ID** `audible-ex@liqweed.github.io`: permanent, since AMO and every
  installed copy know the add-on by it, and Firefox's sync storage, where the prefs
  live, needs a fixed one.
- **Data collection:** `required: ['websiteContent']`. Since 3 November 2025 new
  add-ons must declare what leaves the browser, and Mozilla counts anything handled
  outside the add-on or the browser. The titles, authors and ASINs read from Audible
  pages go to Goodreads and Audible's catalogue. That is website content, as the
  Chrome listing already says; "none" would be wrong. It is required, not optional:
  the extension does nothing without it.
- **Firefox 140 and Android 142** at least, where Firefox's own consent prompt
  exists; older versions would need a consent screen of our own.
- **MV2**, WXT's default for Firefox: a persistent background page, so the port and
  the cache behave as they do under Chrome's worker without its lifetime limits.
- **Desktop only** at first; Android is offered once someone has tried Audible's
  mobile pages with it.

The build is reproducible: `bun run zip:firefox` on macOS gave the v0.6.0 release's
Firefox zip (built on Linux in CI) file for file, so a reviewer can rebuild the
upload from the source archive with the steps in README.md. `web-ext lint` passes
with four warnings, all `innerHTML` inside React DOM.

Later: `release.yml` submits each release to AMO beside the Chrome Web Store, with
an AMO API key in its own environment, as D20 does for Chrome. WXT's `wxt submit`
(`publish-browser-extension`, already installed with WXT) can do the upload.
Rejected for now: MV3 for Firefox (event pages instead of a persistent page, for no
gain to users) and listing on Android untested.

## D30 — Highlights survive dimming, a deals-only price limit, and the product page's own book (2026-11-05)

A book can be dimmed for a reason the reader weighs differently, such as a price over
the limit, while its labels make it interesting. A highlighted card that a filter dims
(or a carousel softens from hide) is now drawn at full strength: `badges.css` lifts the
dimming where `data-agx-highlight` is set. Its verdict, the counters and the lookups are
unchanged, and a card that a filter hides is still hidden: highlighting never overrides
a `hide`, and a book a `hide` filter holds back is not looked up, so it has no labels to
highlight (use Dim for the filters that should still let a highlight through). Rejected:
a setting for it (nobody highlights a label to see it faded), and exempting highlighted
books from `hide` (the "never hide for data it does not have" and "filters never undone"
rules in D28 depend on `hide` being final).

Prefs v8 adds `filters.priceOnDeals` (default off). When on, the price limit is in force
only on a deals page, so search, categories and the library are not filtered by price.
`settingsFor(settings, page)` in `src/core/filter.ts` empties `maxPrice` elsewhere, and the
content script's applier stores the settings through it, so the verdict, the eager-filtering
depth and the price requests all agree. The page kind is `pageKind`'s: a path with `deals`
in it (`/ep/audiobook-deals`, `/ep/summer-deals-2026`). That is reliable for Audible's English
deals pages and unverified for other languages' paths or the home page's daily deal; the
setting says so. Rejected: reading the page's heading or markup (it changes between campaigns),
and a list of paths per marketplace (stale as soon as a campaign is renamed).

A product page (`/pd/<title>/<ASIN>`) never links to its own book, so the scanner found
no card there. Audible draws the book as one `adbl-product-hero` (title in
`adbl-title-lockup`'s slots, cover in `adbl-product-image`, the buy box); the scanner takes
that element as the card, with the ASIN from the page address. The badge goes after the
`adbl-title-lockup` with `slot="title-lockup"`: a node put after the title heading inside the
lockup has no slot and is not drawn (measured on audible.co.uk, 0 by 0 against 90 by 22
pixels). The hero is never hidden or dimmed, and not counted: the reader opened the page for
that book. It still gets a rating, the overview, the labels and the highlight. Checked only
on the `.co.uk` page of 2026-11-05, signed out; a template without `adbl-product-hero` still
shows no badge.

## D31 — A highlight price beside the price limit, drawn as a chip (2026-11-05)

Asked for: mark the price of a book that costs less than a threshold, instead of
filtering the ones that cost more. It is a control of its own, `filters.highlightPrice`
(a ceiling per marketplace, in its currency, inclusive, absent is off), next to the
highlight rating, not a third miss mode of the price limit. The limit acts on prices
above its ceiling and the highlight on prices at or under its own, so one threshold
cannot be both, and users can want both (hide above 15, highlight at 5 or less). Like the
other highlights it is not a filter: it never changes a verdict, works with the filters
off, and is not restricted to deals pages by `priceOnDeals`. It reads the same public
catalogue price as the limit (D23), so the panel says member offers can differ.

The mark is a chip the extension draws, `£3.99` in the highlight's amber, after the
badge and the year (`markPrice`, `src/content/badges.ts`), only on books at or under the
limit; the cover is left alone, as asked. Rejected: restyling Audible's own price text.
Its markup is not one thing: search and wish list cards carry `p.buybox-regular-price`
(the wish list adds a struck-through regular price and a member price), the saved UK
deals page carries no price on its cards at all, and library rows none, so a selector
would mark the wrong price or nothing. A chip also stays ours to place and style, as the
year and labels are. Prices are now requested when the limit is in force or the highlight
price is set (`wantsPrices`); nothing about the Goodreads lookup changes. Prefs v8 carries
it with `priceOnDeals`, since v8 had not shipped.

## D32 — One gentle request to rate the extension (2026-11-08)

Ratings in the stores are how a small extension is found, and a person who has used it for
days is the one whose rating means something. The extension asks once, and only that person.

- **When.** Ratings were shown on three different local days, and either the user changed a
  setting (any difference from the defaults but the master switch: a filter, a highlight, the
  display) or the extension has shown 200 ratings, which stands for heavy use with no need to
  change anything. A day without a rating is not a day of use.
- **Once.** The request counts as used when it appears, not when it is answered: ignoring it
  does not earn another. Its flag is `sync:nudge`, one boolean, so a user with several
  computers is asked once. "Rate it" and "Not now" both end it.
- **Where.** The panel, in its footer, only when its lookups are done and it is open (never in
  the middle of the work, never in the collapsed pill), and the toolbar popup when it is opened,
  whichever comes first. Never in Audible's own page, and never a notification or a tab. A quiet
  "Rate" link in the popup's footer and a link on the options page stay for anyone who looks.
- **What it says.** A sentence and two choices. It asks for a rating, not a good one, offers
  nothing in return and does not send the unhappy elsewhere: Chrome Web Store policy forbids
  incentivized or manipulated ratings, and asking everyone who qualifies is the honest version.
- **Where the link goes.** The reviews tab of the store this build is in: the Chrome Web Store
  listing's `/reviews`, or the AMO listing's `/reviews/` in Firefox (`REVIEW_URL`,
  `src/lib/links.ts`). Opening it is a plain link the user clicks; no permission is needed.
- **How it counts.** The panel script counts the books that become ready with a rating and
  writes `local:engagement` in batches (`src/panel/engagement.ts`). It lives there because the
  panel already has the page's books; the worker, the port and the queue are untouched, so
  nothing near Goodreads changes. The counters never leave the device (PRIVACY.md says so).

Rejected: a badge or a number on the toolbar icon (a constant reminder, and it needs the
worker to track state); a page on first install (no use to judge yet); a notification
(needs a permission); asking again after "Not now" after some months (the request was
"no more than a single nudge"; the permanent links cover the rest); counting in the worker
(couples the lookup path to a product feature). The 200 ratings and three days are
starting points, not measured.
