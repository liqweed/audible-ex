# Firefox Add-ons (AMO) listing

The text and answers for addons.mozilla.org, kept here so they are reviewed like
code and stay in step with the manifest and [PRIVACY.md](../PRIVACY.md), as the
Chrome listing is in [STORE-LISTING.md](STORE-LISTING.md). When a permission, host
or data flow changes, change this file in the same pull request.

| Item          | Value                                                   |
| ------------- | ------------------------------------------------------- |
| Add-on ID     | `audible-ex@liqweed.github.io` (permanent; `wxt.config.ts`) |
| Minimum       | Firefox 140; Firefox for Android 142 (not offered yet)  |
| Developer Hub | https://addons.mozilla.org/developers/addons            |
| Package       | `audible-ex-<version>-firefox.zip` (MV2), from a release |
| Source        | `audible-ex-<version>-sources.zip`, from the same release |

## First submission, by hand

Both zips come from a GitHub release (`gh release download v<version> -p
'*firefox.zip' -p '*sources.zip'`), so what is uploaded is what CI built.

1. Sign in at https://addons.mozilla.org/developers/ with the Firefox account
   that will own the add-on, and accept the developer agreement.
2. **Submit a New Add-on** → **On this site** → upload
   `audible-ex-<version>-firefox.zip`. The automatic validation should pass with
   four warnings, all `innerHTML` inside React (see [Notes for
   reviewers](#notes-for-reviewers)).
3. **Compatibility:** Firefox only. Leave Android unticked until the extension
   has been tried on Audible's mobile pages.
4. **Source code:** *Yes*, upload `audible-ex-<version>-sources.zip`.
5. Fill in the listing from [Listing](#listing) and paste the notes for
   reviewers, then submit. Review takes from hours to weeks.
6. After approval, install it from its AMO page and check badges on two
   marketplaces, a filter, and the panel.

Later releases add a version to this add-on; they never create a new one. Until
`release.yml` submits to AMO, upload each release's two zips the same way
(**Upload New Version** on the add-on's page).

## Listing

**Name:** Book Ratings for Audible. **Add-on URL:** `book-ratings-for-audible`. Keep that
slug: the Firefox build links to `https://addons.mozilla.org/firefox/addon/book-ratings-for-audible/reviews/`
for its request to rate the extension (DECISIONS.md D32, `src/lib/links.ts`), and the link
works only after the first submission is approved.

**Summary** (at most 250 characters):

> Shows Goodreads ratings, genres and first-published years on Audible book
> cards, and hides or dims the books you'd skip. Not affiliated with Audible,
> Amazon or Goodreads.

**Description:** the Chrome description ([STORE-LISTING.md](STORE-LISTING.md),
"Store listing tab"), with "follow your Chrome profile" changed to "follow your
Firefox account".

**Categories:** Shopping; Search Tools. **Tags:** audible, goodreads,
audiobooks, ratings.

**Support site:** https://github.com/liqweed/audible-ex/issues. **Homepage:**
https://github.com/liqweed/audible-ex.

**License:** MIT License.

**Privacy policy:** paste [PRIVACY.md](../PRIVACY.md) without its title (AMO
takes the text, not a link).

**Data collection** (from the manifest, shown at install): *Website content*,
required. The titles, authors and ASINs of the books on Audible pages go to
Goodreads and Audible's catalogue API to look the books up. Nothing else.

**Screenshots:** the six from `bun e2e` (`.output/store/`), in the Chrome
order, with the cache inspector sixth. They show Chrome, which is fine: the extension looks the same.

## Notes for reviewers

```text
Build from the source archive (README.md, "Building the store packages from source"):
install Bun 1.4.0 and Node.js 24 (mise.toml), then `bun install --frozen-lockfile`
and `bun run zip:firefox`. The output, .output/audible-ex-<version>-firefox.zip,
is file for file the uploaded package.

Network: the background page fetches only https://www.goodreads.com (book search
by title and author, and the matched book's public page) and the Audible catalogue
API of the marketplace being browsed (https://api.audible.<tld>, by ASIN). No
cookies are sent (credentials: 'omit'). No remote code, no analytics.

The four innerHTML warnings are in React DOM (react-dom's dangerouslySetInnerHTML
support and its <script> element workaround), bundled into the panel. The
extension's own code never sets innerHTML or uses dangerouslySetInnerHTML.

To try it: open https://www.audible.co.uk/search?keywords=dune (audible.com's
search pages show an error outside the US). Ratings appear under each title; the
floating panel holds the filters.
```
