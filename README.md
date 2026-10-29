# audible-ex

A Chrome extension that shows Goodreads ratings on Audible. Every book card
gets its Goodreads rating, number of ratings, first-published year and top
genres, with the Goodreads overview on hover. A floating panel shows lookup
progress and holds your filters: minimum rating, minimum number of ratings,
genres to hide, and later price and year. Filters are saved and follow you
across devices and Audible marketplaces.

Works on all ten Audible marketplaces: `.com`, `.co.uk`, `.ca`, `.com.au`,
`.in`, `.de`, `.fr`, `.it`, `.es` and `.co.jp`.

## Status

Not released yet. The design and plan are done, and the toolchain is in place;
porting the userscript (phase 1) comes next. Until the extension reaches parity, the userscript in
[`reference/`](reference/audible-goodreads-ratings.user.js) does the rating part
in any userscript manager (Tampermonkey, Violentmonkey).

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
your browser.

## Licence

[MIT](LICENSE). The licence covers this code only; it grants no rights to the
Audible, Amazon or Goodreads names or logos.

This project is not affiliated with Audible, Amazon or Goodreads. Ratings and
descriptions come from Goodreads, and every rating links back to its Goodreads
page.
