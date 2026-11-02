# Book Ratings for Audible

A Chrome extension (repository name `audible-ex`) that shows Goodreads ratings
on Audible. Every book card gets its Goodreads rating, number of ratings,
first-published year and top genres, with the Goodreads overview on hover.
Coming next: a floating panel that shows lookup progress and holds your filters
(minimum rating, minimum number of ratings, genres to hide, and later price and
year), saved and following you across devices and Audible marketplaces.

Works on all ten Audible marketplaces: `.com`, `.co.uk`, `.ca`, `.com.au`,
`.in`, `.de`, `.fr`, `.it`, `.es` and `.co.jp`.

## Status

Release 0.1 does what the userscript in
[`reference/`](reference/audible-goodreads-ratings.user.js) does: badges with
rating, year and genres, the hover overview, and an on/off switch and cache
controls in the toolbar popup. It is headed for the Chrome Web Store, unlisted
at first ([docs/STORE-LISTING.md](docs/STORE-LISTING.md)). The floating panel
and filters come next ([docs/PLAN.md](docs/PLAN.md)).

| Document                                     | What it holds                               |
| -------------------------------------------- | ------------------------------------------- |
| [docs/PRD.md](docs/PRD.md)                   | What the extension does and why             |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is built                             |
| [docs/PLAN.md](docs/PLAN.md)                 | Phases, order and what's left               |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | Decisions made and what was rejected        |
| [GLOSSARY.md](GLOSSARY.md)                   | The terms used throughout                   |
| [AGENTS.md](AGENTS.md)                       | Working agreements for people and AI agents |

## Development

Stack: WXT on Vite, React 19, Tailwind 4, Effect 4, TanStack, TypeScript 7,
Bun, Biome. Tool versions are pinned in `mise.toml`.

```sh
mise install && bun install
bun dev           # Chrome with hot reload
bun check         # lint, types, tests: what CI runs
bun run build     # .output/chrome-mv3, load it as an unpacked extension
```

See [AGENTS.md](AGENTS.md) for the current state.

## Privacy

No server, no account, no analytics. The extension reads Audible pages
(including your Library and Wish List) to find the books on them, and sends
each book's title and author to Goodreads to look it up. Nothing else leaves
your browser. The full policy is [PRIVACY.md](PRIVACY.md).

Not affiliated with Audible, Amazon or Goodreads.

## Licence

[MIT](LICENSE). The licence covers this code only; it grants no rights to the
Audible, Amazon or Goodreads names or logos.

This project is not affiliated with Audible, Amazon or Goodreads. Ratings and
descriptions come from Goodreads, and every rating links back to its Goodreads
page.
