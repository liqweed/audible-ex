# Fixtures

Saved Audible pages and Goodreads responses that the matching, parsing and
card-detection tests run against (GLOSSARY: **Fixture**). They are real, not
hand-written: `scripts/capture-fixtures.ts` fetches them, so a failing fixture
test after a refresh is how we notice that Audible or Goodreads changed.

## Refreshing

```sh
bun scripts/capture-fixtures.ts            # everything: 70 requests, about 3 minutes
bun scripts/capture-fixtures.ts audible    # the 8 public Audible pages
bun scripts/capture-fixtures.ts catalog    # the 2 Audible catalogue API responses
bun scripts/capture-fixtures.ts goodreads  # autocomplete and book pages for the 20 books
bun scripts/capture-fixtures.ts --list     # print the requests; send none
```

Run it by hand, never in CI (it refuses when `CI` is set). It follows
AGENTS.md "Respect the sources": one request at a time with a 2 s pause, no
cookies, its own honest User-Agent, redirects followed only within the same
site, a wait and retry on 429/503 (never sooner than `Retry-After`; it gives up
at once if that asks for more than two minutes) and then it stops asking that
site for the run. A 403 stops the site straight away. A page that fails its checks (a block page,
fewer than 10 book links, personal data left in) never replaces the fixture
already there; the script reports it and exits 1.

Then read `git diff --stat test/fixtures`. The sites move on their own, so a
second run straight after the first still shows changes: rating counts and
result order on Goodreads, catalogue counts and A/B test markup on Audible
(measured minutes apart). What the script itself guarantees is that it writes
only inside this directory and puts no timestamp, request id or token into a
file, so every change in the diff comes from the site.

## What is stripped

- **Audible pages** keep their markup (links, list items, headings, popovers
  are what card detection reads). Removed: `script`, `style`, `noscript`,
  `svg` and `iframe` elements, comments, `<meta>` and `<link>`, Amazon's logging
  pixels, hidden-input values, nonce/csrf/token attributes, per-request URL
  parameters (`pf_rd_*`, `pageLoadId`, `creativeId`, encoded blobs such as
  `buyingOptionId`), and any email address. The `ref=` parameter stays: it names
  a page position and is the same on every load.
  audible.com is requested with `ipRedirectOverride=true`, Audible's own
  parameter for staying on the requested marketplace; without it a visitor
  outside the US is sent to their local site.
- **Goodreads autocomplete** is the response as served, except `qid` (a random
  id per request) is set to `"fixture"`.
- **Goodreads book pages** are reduced to the `__NEXT_DATA__` script element,
  which is all the extension reads, pretty-printed so refreshes diff by line.
  Only an allowlist of its fields is kept (`props.pageProps.apolloState`,
  `params`, `query`, `locale`, `dataSource`, `buildId`), so the session values
  (`jwtToken`, `apiKey`, `authContextParams`, `userAgent*`, weblabs) and anything
  Goodreads adds later are left out. Inside `apolloState` only `Book`, `Work` and
  `Contributor` entities are kept; every `User`, `Review` and `Shelving` entity
  (reviewers' names and profiles), ads and banners are removed, along with
  `Work.featuredKNH` (a notable reader's name) and `Contributor.user`. If a
  reference to a user is still there after that, the script refuses to write the
  page.

`test/fixtures/fixtures.test.ts` fails the build if a committed fixture holds an
email address, an order or account id, a greeting with a name, or Goodreads
session or reviewer data.

## Audible pages

Each exists for `uk` (audible.co.uk) and `com` (audible.com). Captured signed
out.

| File                                  | Page                                                    | Captured by |
| ------------------------------------- | ------------------------------------------------------- | ----------- |
| `audible/{uk,com}/home.html`          | `/`                                                     | script      |
| `audible/{uk,com}/search.html`        | `/search?keywords=andy+weir` (one author, many books)   | script      |
| `audible/{uk,com}/category.html`      | Science Fiction & Fantasy category                      | script      |
| `audible/{uk,com}/deals.html`         | `/ep/audiobook-deals`                                   | script      |
| `audible/{uk,com}/library.html`       | `/library/titles`, first page                           | by hand     |
| `audible/{uk,com}/wishlist.html`      | `/wl`, first page                                       | by hand     |
| `audible/{uk,com}/catalog.json`       | `api.audible.<tld>/1.0/catalog/products`, see below     | script      |

Library and wish list need a signed-in browser, so they are saved by hand and
cleaned by the script's `import` command. They do not exist until someone
captures them; until then phase 1's library and wish-list card tests have
nothing to run on.

### Catalogue API responses

`audible/{uk,com}/catalog.json` is what the background reads for the ASINs of
books in the saved pages: one `catalog/products` request per marketplace, with
the userscript's `response_groups=contributors,product_desc`, answered as
served. Three ASINs each. The `uk` request also carries `B08G9PRS1K`, the
`.com` edition of Project Hail Mary, which `.co.uk` does not list: the API
answers a bare `{ "asin": … }` for it, the "not carried" case that
`AudibleCatalog` maps to `NoMetadata`. The response names only publicly listed
authors and narrators.

### Capturing library and wish list by hand

Do this once per marketplace and page, in a browser you are signed in to.

1. Open the page (`https://www.audible.co.uk/library/titles`, then
   `/wl`; the same on `audible.com`). Keep the first page of results: a short
   list is enough and keeps the fixture small.
2. Let it finish loading, then save the rendered DOM: in DevTools, right-click
   the `<html>` element in the Elements panel, Copy, Copy outerHTML, and paste
   into a file. (File, Save Page As can leave out lazily loaded cards.)
3. Clean and place it, naming everything that identifies you with `--redact`
   (your first name, surname, nickname, as the page shows them):

   ```sh
   bun scripts/capture-fixtures.ts import library uk ~/Downloads/library.html \
     --redact "First" --redact "Last"
   ```

   It applies the same cleaning as the public pages, replaces each redacted
   whole word with `REDACTED` (names with accents or HTML entities may need
   a second look), refuses to write if an email, order id, account id
   or "Hello, Name" greeting is left, and writes
   `audible/<uk|com>/<library|wishlist>.html`.
4. Open the written file and search it for your name, email, address and
   anything else personal before you commit. The script can only remove what it
   recognises or is told about.

## Goodreads

For each book, two autocomplete responses and the book page. The queries are the
two the userscript sends: the title before any subtitle (`title`), then that
title plus the author (`title-author`). The Goodreads id is pinned in the
script, so a refresh fetches the same book page even if the autocomplete order
shifts. Files: `goodreads/autocomplete/<slug>.title.json`,
`goodreads/autocomplete/<slug>.title-author.json`,
`goodreads/book/<id>-<slug>.html`.

| `slug`                              | Goodreads id | Why it is here                                                        |
| ----------------------------------- | ------------ | --------------------------------------------------------------------- |
| `project-hail-mary`                 | 54493401     | Summary editions rank right after the real book                       |
| `the-martian`                       | 18007564     | Unrelated books with a similar title (`The Martian Chronicles`)       |
| `harry-potter-1`                    | 3            | Series number in the Audible title (`, Book 1`); US vs UK title       |
| `dune`                              | 44767458     | Short common title; series number and omnibus entries in the results  |
| `the-hobbit`                        | 5907         | Author written with initials; several editions and adaptations        |
| `1984`                              | 61439040     | Title that is a number; other books sharing it                        |
| `atomic-habits`                     | 40121378     | Subtitle; unofficial summaries and workbooks                          |
| `sapiens`                           | 23692271     | Subtitle; the title word also begins unrelated books                  |
| `the-way-of-kings`                  | 7235533      | Series in the Audible subtitle; split parts and boxed sets            |
| `the-name-of-the-wind`              | 186074       | Series in the Audible subtitle; study guides                          |
| `circe`                             | 35959740     | One-word title that is also a first name                              |
| `the-road`                          | 6288         | Very common title; `On the Road` ranks second                         |
| `educated`                          | 35133922     | One-word title; verb-like words in other titles                       |
| `thinking-fast-and-slow`            | 11468377     | Comma in the title; "Summary" and "Simplified" editions               |
| `the-subtle-art`                    | 28257707     | Punctuation (`F*ck`); journals and summaries                          |
| `les-miserables`                    | 24280        | Diacritics; adaptations and companions with the same title            |
| `the-girl-with-the-dragon-tattoo`   | 2429135      | Translated; series in the subtitle; graphic novel editions            |
| `the-fellowship-of-the-ring`        | 61215351     | Series in the subtitle; companions and trilogy editions               |
| `becoming`                          | 38746485     | One-word title; many unrelated "Becoming ..." books                   |
| `rich-dad-poor-dad`                 | 69571        | Edition text in the Audible title; sequels and "Wisdom from ..."      |

Titles and authors in the script are written the way Audible lists them, but
they are not read off a live Audible page.
