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
