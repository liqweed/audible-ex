---
name: ui-gallery
description: See and check how the extension's UI looks (badges, labels, highlighted covers, the label popover, the rating overview, the floating panel and its pill) without loading the extension; add a gallery scene for a new UI state; run the visual regression tests; try a style on a live Audible page; retake the store screenshots. Use whenever a change touches what the extension draws (CSS, a component, a popover) or someone asks for a screenshot.
---

# The UI gallery: seeing and checking the extension's UI

The extension draws on Audible pages, which a terminal cannot open with the
extension loaded. The gallery (`test/gallery/`, ARCHITECTURE.md §10, DECISIONS.md
D27) draws every UI state from the real code and stylesheets over made-up books,
offline, so it looks the same every time. Run every command from the repository
root, and put anything you make for yourself (previews, screenshots, notes) in
`.context/`, never elsewhere in the tree.

## Look at the UI

```sh
bun run gallery        # http://localhost:4174: an index of the scenes; ?scene=<id> opens one
```

The scenes are listed in `test/gallery/scenes.ts`; each is drawn by the function of
the same id in `test/gallery/main.tsx`. To see one without a browser, read its
baseline: `test/gallery/__screenshots__/<platform>/<id>.png` (`darwin` on a Mac).

## Check a UI change

1. Make the change. If it adds a state the gallery does not show yet, add a scene
   (below) first.
2. `bun run visual`. It starts its own server (port 4175, so an open gallery does
   not matter) and compares each scene with its baseline, allowing 10 pixels.
3. A failure writes the expected, actual and diff images to `.output/visual/`;
   `.output/visual-report/index.html` shows them side by side. Read every one that
   changed. A difference you did not intend is a regression: fix the code, not the
   baseline.
4. When every difference is what you meant: `bun run visual:update` rewrites all the
   baselines. Read the new PNGs, then commit them with the change, and say in the pull
   request which scenes changed and why.

Baselines are per platform and do not run in CI (D27): run `bun run visual` yourself
before pushing a UI change. On a platform with no baselines yet, the first run
writes them; review them like any other change.

## Add a scene

1. Add `{ id, title }` to `SCENES` in `test/gallery/scenes.ts`.
2. Add a function with that id to `draw` in `test/gallery/main.tsx`. Use the helpers
   there: `drawCards` (search results or a carousel, badges and filter marks from the
   real applier), `labelPopover`, `createOverview`, `drawPanel` (the panel in a shadow
   root, as the panel script mounts it) and `until` (wait for an element). Put books in
   `BOOKS` when a state needs a new one.
3. Drive the UI to the state the scene shows (click a button, focus an `i`) and
   `await` until it is drawn: the page is captured once the function resolves.
4. Keep it deterministic: no network, no real time (the panel's clock is `NOW`),
   no randomness, no remote images (covers are drawn SVGs whose address carries
   `/images/I/`, so `coverOf` finds them).
5. `bun run visual:update -g "<title>"`, read the new PNG, commit it.

## Try a style on a live Audible page

The gallery's page is a stand-in. To see a style against Audible's own layout (a
carousel's clipping, real covers), use the Playwright browser tools:

- open `https://www.audible.co.uk/search?keywords=…&ipRedirectOverride=true` (the
  parameter stops Audible sending a visitor elsewhere to their own marketplace);
- inject the stylesheet (`src/content/badges.css`, `overview.css`) as a `<style>`
  and add the extension's attributes and markup to a few cards
  (`data-agx-highlight` on the card, `data-agx-shine` on its cover, a `.agx-wrap`
  of badge and labels after the title);
- screenshot it into `.context/` and read it.

This changes nothing on Audible and sends no request beyond loading the page.

## Retake the store screenshots

They must show the real site, so they come from `bun e2e` (Playwright with the
built extension on live Audible, never in CI), which writes them to `.output/store/`
(docs/STORE-LISTING.md). Build first (`bun run build`); the run takes a few minutes
and uses the extension's normal lookups.
