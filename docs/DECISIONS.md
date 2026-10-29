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

Moving the scaffold to the D2 stack (issue #18) needed four choices D2 didn't
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
IndexedDB, behind the `BookCache` service. The phase 0 spike (issue #21)
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
