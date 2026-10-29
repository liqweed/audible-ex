// ==UserScript==
// @name         Audible → Goodreads ratings
// @namespace    https://github.com/local/audible-goodreads
// @version      2.4.0
// @description  Shows Goodreads ratings, first-published year, genre labels and overview (on hover) on Audible cards (search, deals, home daily deal, library, wish list). Cached locally.
// @match        https://www.audible.co.uk/*
// @match        https://www.audible.com/*
// @match        https://www.audible.ca/*
// @match        https://www.audible.com.au/*
// @match        https://www.audible.de/*
// @match        https://www.audible.fr/*
// @match        https://www.audible.it/*
// @match        https://www.audible.es/*
// @match        https://www.audible.in/*
// @match        https://www.audible.co.jp/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      www.goodreads.com
// @connect      api.audible.co.uk
// @connect      api.audible.com
// @connect      api.audible.ca
// @connect      api.audible.com.au
// @connect      api.audible.de
// @connect      api.audible.fr
// @connect      api.audible.it
// @connect      api.audible.es
// @connect      api.audible.in
// @connect      api.audible.co.jp
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  // ---------- settings ----------
  const TTL_HIT = 30 * 864e5;   // keep found ratings 30 days
  const TTL_MISS = 7 * 864e5;   // retry "not found" after 7 days
  const GR_CONCURRENCY = 3;     // parallel Goodreads requests
  const GR_GAP_MS = 250;        // pause between Goodreads requests per worker
  const META_BATCH = 40;        // ASINs per Audible catalog call
  const CACHE_PREFIX = 'gr3:';
  const META_PREFIX = 'meta2:';
  const DETAIL_PREFIX = 'det1:';  // Goodreads genres + description + year, keyed by Goodreads book id
  const MAX_LABELS = 3;           // genre labels shown under the badge
  const DESC_MAX = 1500;          // characters of the overview kept (about what the hover panel shows)
  const SKIP_GENRES = new Set(['audiobook', 'audiobooks', 'adult', 'books about books', 'unfinished', 'kindle unlimited']);
  // drop ratings cached by older versions of this script (their matching was weaker)
  for (const k of GM_listValues()) if (k.startsWith('gr2:')) GM_deleteValue(k);

  const API_HOST = location.hostname.replace(/^www\./, 'api.');
  const ASIN_RE = /\/(?:pd\/(?:[^/?#]+\/)?)([A-Z0-9]{10})(?=[/?#]|$)/;

  // ---------- styles ----------
  GM_addStyle(`
    .agr-badge{display:inline-flex;align-items:center;gap:4px;margin:4px 0 2px;padding:1px 7px;
      border-radius:10px;font:600 12px/18px system-ui,sans-serif;text-decoration:none!important;
      background:#f4f1ea;color:#382110!important;border:1px solid #d8d0c0;white-space:nowrap;vertical-align:middle}
    .agr-badge:hover{background:#e9e3d6}
    .agr-badge .agr-n{font-weight:400;opacity:.75}
    .agr-badge.agr-hi{background:#e3f2e1;border-color:#a9d3a2}
    .agr-badge.agr-lo{background:#f8e5e1;border-color:#e0b0a6}
    .agr-badge.agr-wait,.agr-badge.agr-none{opacity:.6;font-weight:400}
    .agr-wrap{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:2px 0}
    .agr-wrap .agr-badge{margin:0}
    .agr-year{font:600 11px/17px system-ui,sans-serif;color:#7a6a58;padding:0 2px}
    .agr-label{display:inline-block;padding:0 6px;border-radius:9px;font:400 11px/17px system-ui,sans-serif;
      background:#fff;color:#5c4a3a;border:1px solid #e2dacb;white-space:nowrap}
    .agr-tip{position:fixed;z-index:2147483647;max-width:420px;max-height:60vh;overflow:hidden;
      padding:10px 12px;border-radius:8px;background:#fffdf8;color:#2b2118;border:1px solid #d8d0c0;
      box-shadow:0 6px 24px rgba(0,0,0,.18);font:13px/1.45 system-ui,sans-serif;white-space:pre-line;pointer-events:none}
    .agr-tip b{display:block;margin-bottom:4px;font-size:13px}
    .agr-tip .agr-tip-meta{display:block;margin-bottom:6px;opacity:.7;font-size:12px}
    .agr-tip .agr-tip-fade{position:absolute;left:0;right:0;bottom:0;height:28px;background:linear-gradient(transparent,#fffdf8)}
  `);

  // ---------- cache ----------
  const cacheGet = (k) => {
    const v = GM_getValue(k);
    if (!v) return null;
    if (Date.now() - v.t > (v.miss ? TTL_MISS : TTL_HIT)) return null;
    return v;
  };
  const cacheSet = (k, v) => GM_setValue(k, { ...v, t: Date.now() });
  const mem = new Map(); // in-page memo: asin -> Promise<result>

  // ---------- pinned books (seen in your Library, collections or Wish List) ----------
  // Pinned books survive the automatic clean-up; everything else (deals, search, home page) is
  // deleted once its cache entry is older than PURGE_AGE.
  const PURGE_AGE = 32 * 864e5;      // unpinned entries never outlive this
  const PIN_KEEP = 180 * 864e5;      // a book stays pinned this long after you last saw it in Library/Wish List
  const PINNED_KEY = 'pinned';       // { asin: lastSeenTimestamp }
  const ON_MY_PAGES = location.pathname.startsWith('/library'); // titles, collections, wishlist

  let pinned = GM_getValue(PINNED_KEY, {});
  let pinSaveTimer = null;
  function pin(asin) {
    if (!ON_MY_PAGES) return;
    const now = Date.now();
    if (now - (pinned[asin] || 0) < 864e5) return; // already refreshed today
    pinned[asin] = now;
    clearTimeout(pinSaveTimer);
    pinSaveTimer = setTimeout(() => {
      // merge with what other tabs may have written meanwhile
      pinned = { ...GM_getValue(PINNED_KEY, {}), ...pinned };
      GM_setValue(PINNED_KEY, pinned);
    }, 1000);
  }

  const OUR_PREFIXES = [CACHE_PREFIX, META_PREFIX, DETAIL_PREFIX];
  const isOurs = (k) => OUR_PREFIXES.some((p) => k.startsWith(p));

  // Deletes cache entries. keepPinned: spare Library/Wish List books. maxAge: only delete entries older than this.
  function purge({ keepPinned, maxAge = null }) {
    const now = Date.now();
    pinned = GM_getValue(PINNED_KEY, {});
    for (const [a, ts] of Object.entries(pinned)) if (now - ts > PIN_KEEP) delete pinned[a];
    GM_setValue(PINNED_KEY, pinned);

    const keepAsins = keepPinned ? new Set(Object.keys(pinned)) : new Set();
    const keepBookIds = new Set();
    for (const a of keepAsins) { const id = GM_getValue(CACHE_PREFIX + a)?.url?.match(/\/book\/show\/(\d+)/)?.[1]; if (id) keepBookIds.add(id); }

    let n = 0;
    for (const k of GM_listValues()) {
      if (!isOurs(k)) continue;
      const id = k.slice(k.indexOf(':') + 1);
      const isPinned = k.startsWith(DETAIL_PREFIX) ? keepBookIds.has(id) : keepAsins.has(id);
      if (isPinned) { trimDetail(k); continue; }
      if (maxAge != null && now - (GM_getValue(k)?.t || 0) <= maxAge) { trimDetail(k); continue; }
      GM_deleteValue(k); n++;
    }
    return n;
  }

  // shrink overviews stored by older versions (kept up to 2,500 chars) without refetching anything
  function trimDetail(k) {
    if (!k.startsWith(DETAIL_PREFIX)) return;
    const v = GM_getValue(k);
    if (v?.desc?.length > DESC_MAX) GM_setValue(k, { ...v, desc: v.desc.slice(0, DESC_MAX) });
  }

  // automatic clean-up, at most once a day
  if (Date.now() - GM_getValue('lastPurge', 0) > 864e5) {
    GM_setValue('lastPurge', Date.now());
    setTimeout(() => purge({ keepPinned: true, maxAge: PURGE_AGE }), 5000);
  }

  GM_registerMenuCommand('Clear Goodreads cache: deals/search only (keep Library & Wish List)', () => {
    const n = purge({ keepPinned: true });
    alert(`Cleared ${n} entries. Library, collection and Wish List books were kept (${Object.keys(pinned).length} books).`);
  });
  GM_registerMenuCommand('Clear Goodreads cache: everything', () => {
    const n = purge({ keepPinned: false });
    alert(`Cleared ${n} entries. Reload the page to refetch.`);
  });
  GM_registerMenuCommand('Show Goodreads cache size', () => {
    let bytes = 0, books = 0, entries = 0;
    for (const k of GM_listValues()) {
      if (!isOurs(k) && k !== PINNED_KEY) continue;
      entries++; if (k.startsWith(CACHE_PREFIX)) books++;
      bytes += k.length + JSON.stringify(GM_getValue(k)).length;
    }
    alert(`${books} books cached (${entries} entries), about ${(bytes / 1024).toFixed(0)} KB.\n` +
      `${Object.keys(GM_getValue(PINNED_KEY, {})).length} of them are pinned from your Library / Wish List.`);
  });

  // ---------- http ----------
  const get = (url, json = true) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET', url, timeout: 15000,
      headers: { Accept: json ? 'application/json' : 'text/html' },
      onload: (r) => {
        if (r.status !== 200) return reject(new Error('HTTP ' + r.status));
        try { resolve(json ? JSON.parse(r.responseText) : r.responseText); } catch (e) { reject(e); }
      },
      onerror: () => reject(new Error('network')), ontimeout: () => reject(new Error('timeout')),
    });
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Audible metadata (batched) ----------
  let metaQueue = new Map(); // asin -> [resolve, reject]
  let metaTimer = null;
  function getMeta(asin) {
    const cached = cacheGet(META_PREFIX + asin);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      metaQueue.set(asin, [resolve, reject]);
      clearTimeout(metaTimer);
      metaTimer = setTimeout(flushMeta, metaQueue.size >= META_BATCH ? 0 : 120);
    });
  }
  async function flushMeta() {
    const batch = metaQueue; metaQueue = new Map();
    const asins = [...batch.keys()];
    for (let i = 0; i < asins.length; i += META_BATCH) {
      const chunk = asins.slice(i, i + META_BATCH);
      try {
        const j = await get(`https://${API_HOST}/1.0/catalog/products?asins=${chunk.join(',')}&response_groups=contributors,product_desc`);
        const byAsin = new Map((j.products || []).map((p) => [p.asin, p]));
        for (const a of chunk) {
          const p = byAsin.get(a);
          const [res, rej] = batch.get(a);
          if (!p || !p.title) { rej(new Error('no meta')); continue; }
          const m = { title: p.title, author: (p.authors || [])[0]?.name || '' };
          cacheSet(META_PREFIX + a, m);
          res(m);
        }
      } catch (e) {
        for (const a of chunk) batch.get(a)[1](e);
      }
    }
  }

  // ---------- Goodreads lookup (queued, throttled) ----------
  const grQueue = [];
  const grLowQueue = []; // background work (e.g. adding years to old cache entries): runs only when idle
  let grActive = 0;
  // every Goodreads request (search or book page) goes through this queue
  function grQueued(fn, low = false) {
    return new Promise((resolve, reject) => { (low ? grLowQueue : grQueue).push({ fn, resolve, reject }); pumpGr(); });
  }
  const grLookup = (meta) => grQueued(() => searchGoodreads(meta));
  async function pumpGr() {
    while (grActive < GR_CONCURRENCY && (grQueue.length || (grLowQueue.length && grActive === 0))) {
      const job = grQueue.length ? grQueue.shift() : grLowQueue.shift();
      grActive++;
      (async () => {
        try { job.resolve(await job.fn()); }
        catch (e) { job.reject(e); }
        finally { await sleep(GR_GAP_MS); grActive--; pumpGr(); }
      })();
    }
  }

  const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const shortTitle = (t) => norm(t.split(/[:–—]| - /)[0].replace(/\b(unabridged|abridged|dramati[sz]ed)\b/gi, ''));
  const lastName = (a) => norm(a).split(' ').pop() || '';

  async function searchGoodreads({ title, author }) {
    const st = shortTitle(title);
    const ln = lastName(author);
    const bareTitle = title.split(/[:–—]/)[0].trim();
    const ac = async (q) => {
      const l = await get(`https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(q)}`);
      return Array.isArray(l) ? l : [];
    };
    const score = (list) => list.map((b) => {
      const bt = shortTitle(b.bookTitleBare || b.title);
      const authorOk = !ln || norm(b.author?.name).includes(ln);
      const titleOk = bt === st || bt.startsWith(st) || st.startsWith(bt);
      return { b, score: (authorOk ? 2 : 0) + (titleOk ? 1 : 0) };
    }).filter((x) => x.score >= 2 || (x.score === 1 && !ln));

    // 1) title only: finds the real book for famous titles (title + author tends to surface "summary" books)
    // 2) title + author: disambiguates common titles
    let scored = score(await ac(bareTitle));
    if (!scored.some((x) => x.score === 3) && author) {
      scored = scored.concat(score(await ac(`${bareTitle} ${author}`)));
    }
    if (!scored.length) return { miss: true };
    scored.sort((x, y) => y.score - x.score || (y.b.ratingsCount || 0) - (x.b.ratingsCount || 0));
    const b = scored[0].b;
    return {
      r: parseFloat(b.avgRating) || 0,
      n: b.ratingsCount || 0,
      url: 'https://www.goodreads.com' + b.bookUrl.split('?')[0],
      loose: scored[0].score < 3, // author matched but title only roughly
    };
  }

  function ratingFor(asin) {
    if (mem.has(asin)) return mem.get(asin);
    const p = (async () => {
      const cached = cacheGet(CACHE_PREFIX + asin);
      if (cached) return cached;
      const meta = await getMeta(asin);
      const res = await grLookup(meta);
      res.q = `${meta.title} ${meta.author}`;
      cacheSet(CACHE_PREFIX + asin, res);
      return res;
    })();
    p.catch(() => mem.delete(asin)); // errors are not cached; retry on next scan
    mem.set(asin, p);
    return p;
  }

  // ---------- Goodreads book page: genres + description ----------
  const detMem = new Map(); // bookId -> Promise<details>
  const bookIdOf = (res) => res?.url?.match(/\/book\/show\/(\d+)/)?.[1];

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(
      String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n'), 'text/html');
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Pulls only what we need out of the ~400 KB book page, so the page text can be freed right away.
  async function fetchDetails(id) {
    let html = await get(`https://www.goodreads.com/book/show/${id}`, false);
    const START = '<script id="__NEXT_DATA__" type="application/json">';
    const i = html.indexOf(START);
    const j = i < 0 ? -1 : html.indexOf('</script>', i);
    if (j < 0) throw new Error('book page format changed');
    let json = html.slice(i + START.length, j);
    html = null;
    let state = JSON.parse(json)?.props?.pageProps?.apolloState || {};
    json = null;
    const books = Object.values(state).filter((v) => v && v.__typename === 'Book');
    const book = books.find((b) => String(b.legacyId) === String(id)) || books.find((b) => b.bookGenres?.length) || {};
    const work = state[book.work?.__ref] || Object.values(state).find((v) => v && v.__typename === 'Work');
    const pubTime = work?.details?.publicationTime ?? book.details?.publicationTime; // first published, else this edition
    state = null;
    return {
      genres: (book.bookGenres || []).map((g) => g?.genre?.name).filter(Boolean).slice(0, 10),
      desc: htmlToText(book.description || book['description({"stripped":true})'] || '').slice(0, DESC_MAX),
      y: Number.isFinite(pubTime) ? new Date(pubTime).getUTCFullYear() : 0, // 0 = Goodreads has no date
    };
  }

  function detailsFor(res) {
    const id = bookIdOf(res);
    if (!id) return Promise.resolve(null);
    if (detMem.has(id)) return detMem.get(id);
    const p = (async () => {
      const cached = cacheGet(DETAIL_PREFIX + id);
      if (cached) return cached;
      const d = await grQueued(() => fetchDetails(id));
      cacheSet(DETAIL_PREFIX + id, d);
      return d;
    })();
    p.catch(() => detMem.delete(id));
    detMem.set(id, p);
    return p;
  }

  // Entries cached before years were added have no `y`: fetch the year in the background and add it to
  // the existing entry (genres, overview and its age are kept as they are).
  const yearMem = new Map();
  function addYear(res, det) {
    const id = bookIdOf(res);
    if (!id || !det || det.y !== undefined) return Promise.resolve(det);
    if (yearMem.has(id)) return yearMem.get(id);
    const p = (async () => {
      const fresh = await grQueued(() => fetchDetails(id), true);
      const upgraded = { ...det, y: fresh.y };
      GM_setValue(DETAIL_PREFIX + id, upgraded); // keeps det.t, so the entry ages exactly as before
      detMem.set(id, Promise.resolve(upgraded));
      return upgraded;
    })();
    p.catch(() => yearMem.delete(id));
    yearMem.set(id, p);
    return p;
  }

  // ---------- hover panel with the Goodreads overview ----------
  let tip = null;
  function showTip(badge, title, det) {
    hideTip();
    if (!det || !det.desc) return;
    tip = document.createElement('div');
    tip.className = 'agr-tip';
    const h = document.createElement('b'); h.textContent = title || 'Goodreads';
    const meta = document.createElement('span'); meta.className = 'agr-tip-meta';
    meta.textContent = det.genres.slice(0, 6).join(' · ');
    const body = document.createElement('span'); body.textContent = det.desc;
    const fade = document.createElement('span'); fade.className = 'agr-tip-fade';
    tip.append(h, meta, body, fade);
    document.body.appendChild(tip);
    const r = badge.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    let top = r.bottom + 6;
    if (top + tr.height > innerHeight - 8) top = Math.max(8, r.top - tr.height - 6);
    tip.style.top = top + 'px';
    tip.style.left = Math.max(8, Math.min(r.left, innerWidth - tr.width - 8)) + 'px';
  }
  function hideTip() { if (tip) { tip.remove(); tip = null; } }
  addEventListener('scroll', hideTip, { passive: true });

  const visibleGenres = (det) => (det?.genres || []).filter((g) => !SKIP_GENRES.has(g.toLowerCase())).slice(0, MAX_LABELS);

  // year + labels after the badge, overview on hover
  function decorate(badge, res, det) {
    const wrap = badge.parentElement;
    if (!wrap) return;
    wrap.querySelectorAll('.agr-label, .agr-year').forEach((e) => e.remove());
    if (det?.y) {
      const y = document.createElement('span');
      y.className = 'agr-year';
      y.textContent = det.y;
      y.title = 'First published (Goodreads)';
      badge.insertAdjacentElement('afterend', y);
    }
    for (const g of visibleGenres(det)) {
      const l = document.createElement('span');
      l.className = 'agr-label';
      l.textContent = g;
      wrap.appendChild(l);
    }
    if (det?.desc) {
      badge.removeAttribute('title'); // the panel replaces the plain tooltip
      // reads badge._agrDet at hover time, so it also shows a year that was added later
      badge.onmouseenter = () => {
        const d = badge._agrDet;
        if (!d) return;
        showTip(badge, `★ ${res.r.toFixed(2)} · ${res.n.toLocaleString()} ratings${d.y ? ` · first published ${d.y}` : ''}${res.loose ? ' (approximate match)' : ''}`, d);
      };
      badge.onmouseleave = hideTip;
    }
    badge._agrDet = det;
  }

  // ---------- rendering ----------
  const fmtN = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
  function render(badge, res) {
    badge.className = 'agr-badge';
    if (!res || res.miss) {
      badge.classList.add('agr-none');
      badge.textContent = 'GR: not found';
      badge.href = 'https://www.goodreads.com/search?q=' + encodeURIComponent(res?.q || badge.dataset.q || '');
      badge.title = 'No confident Goodreads match — click to search';
      return;
    }
    if (res.r >= 4.2) badge.classList.add('agr-hi'); else if (res.r && res.r < 3.7) badge.classList.add('agr-lo');
    badge.href = res.url;
    badge.title = `Goodreads: ${res.r.toFixed(2)} from ${res.n.toLocaleString()} ratings${res.loose ? ' (approximate title match)' : ''}`;
    badge.innerHTML = `★ ${res.r.toFixed(2)}${res.loose ? '?' : ''} <span class="agr-n">(${fmtN(res.n)})</span>`;
  }

  // ---------- finding cards ----------
  const asinOf = (a) => (a.getAttribute('href') || '').match(ASIN_RE)?.[1];
  // memo: element -> Set of ASINs linked inside it; only lives for one scan, so it never holds nodes
  let asinMemo = null;
  const asinsIn = (el) => {
    const hit = asinMemo?.get(el);
    if (hit) return hit;
    const s = new Set();
    el.querySelectorAll('a[href*="/pd/"]').forEach((a) => { const x = asinOf(a); if (x) s.add(x); });
    asinMemo?.set(el, s);
    return s;
  };

  // The card is the largest ancestor that still only contains links to this one ASIN.
  function cardFor(link, asin) {
    const known = link.closest('li.productListItem, [id^="adbl-library-content-row-"]');
    if (known) return known;
    let el = link, best = link.parentElement;
    for (let i = 0; i < 12 && el.parentElement && el.parentElement !== document.body; i++) {
      el = el.parentElement;
      const s = asinsIn(el);
      if (s.size > 1 || (s.size === 1 && !s.has(asin))) break;
      best = el;
    }
    return best;
  }

  // Does this element's text look like the book's title? (page text may add or drop a subtitle)
  const looksLikeTitle = (el, title) => {
    const t = norm(el.textContent);
    if (!t || t.length > 300) return false;
    const st = shortTitle(title);
    return t === norm(title) || shortTitle(el.textContent) === st || (st.length >= 4 && t.startsWith(st));
  };

  // Find the title element inside `scope`. `inPopover` decides whether popover content is allowed.
  function findTitleEl(scope, asin, title, inPopover) {
    const ok = (e) => inPopover || !e.closest('.bc-popover');
    // 1) a text link to this book's page whose text matches the title (library, search, wish list, deals)
    const links = [...scope.querySelectorAll(`a[href*="${asin}"]`)].filter((a) => ok(a) && a.textContent.trim());
    let el = links.find((a) => looksLikeTitle(a, title)) || links.find((a) => a.closest('h1,h2,h3,h4'));
    // 2) any heading / span holding the title (home-page daily deal)
    if (!el && title) {
      el = [...scope.querySelectorAll('h1,h2,h3,h4,span,p')]
        .find((e) => ok(e) && e.children.length <= 2 && looksLikeTitle(e, title));
    }
    return el || null;
  }

  // Put a badge on the line after the title; returns false if no title was found.
  function placeAfterTitle(scope, wrap, asin, title, inPopover) {
    const el = findTitleEl(scope, asin, title, inPopover);
    if (!el) return false;
    const li = el.closest('li');
    if (li && scope.contains(li) && li !== scope) {
      const newLi = document.createElement('li');
      newLi.className = li.className.replace(/\bagr-\S+/g, '') + ' agr-li';
      newLi.appendChild(wrap);
      li.insertAdjacentElement('afterend', newLi);
    } else {
      (el.closest('h1,h2,h3,h4') || el).insertAdjacentElement('afterend', wrap);
    }
    return true;
  }

  const makeWrap = (badge) => {
    const wrap = document.createElement('span');
    wrap.className = 'agr-wrap';
    wrap.appendChild(badge);
    return wrap;
  };

  const seen = new WeakSet();
  const pending = new WeakMap(); // card -> asin
  // IntersectionObserver keeps every observed element alive, even after the page removes it,
  // so we track them and let go of removed ones (see pruneObserved).
  const observed = new Set();

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      observed.delete(e.target);
      process(e.target, pending.get(e.target));
    }
  }, { rootMargin: '400px 0px' });

  function pruneObserved() {
    for (const c of observed) if (!c.isConnected) { io.unobserve(c); observed.delete(c); }
  }

  const newBadge = () => {
    const badge = document.createElement('a');
    badge.target = '_blank'; badge.rel = 'noopener';
    badge.className = 'agr-badge agr-wait';
    badge.textContent = 'GR …';
    badge.addEventListener('click', (ev) => ev.stopPropagation());
    return badge;
  };

  async function process(card, asin) {
    if (!card.isConnected || card.querySelector('.agr-badge')) return;
    let title = '';
    try { title = (await getMeta(asin)).title; } catch { /* fall back to card end */ }
    if (card.querySelector('.agr-badge')) return;

    const badges = [];
    // main badge, in the visible card (never inside the hidden hover popover)
    const main = newBadge();
    const mainWrap = makeWrap(main);
    if (!placeAfterTitle(card, mainWrap, asin, title, false)) {
      const pop = card.querySelector('.bc-popover');
      pop ? pop.insertAdjacentElement('beforebegin', mainWrap) : card.appendChild(mainWrap);
    }
    badges.push(main);
    // extra badge in each hover popover that belongs to this card
    card.querySelectorAll('.bc-popover').forEach((pop) => {
      const b = newBadge();
      if (placeAfterTitle(pop, makeWrap(b), asin, title, true)) badges.push(b);
    });

    try {
      const res = await ratingFor(asin);
      badges.forEach((b) => render(b, res));
      if (!res.miss) {
        const paint = (det) => badges.forEach((b) => b.isConnected && decorate(b, res, det));
        detailsFor(res)
          .then((det) => { paint(det); return addYear(res, det); })
          .then((det) => { if (det?.y) paint(det); })
          .catch(() => { /* rating still shows; labels/overview/year retry on next page load */ });
      }
    } catch (err) {
      badges.forEach((b) => {
        b.className = 'agr-badge agr-none';
        b.textContent = 'GR: retry';
        b.title = 'Lookup failed (' + err.message + '). Click to retry.';
        b.href = '#';
        b.onclick = (ev) => {
          ev.preventDefault();
          card.querySelectorAll('.agr-wrap').forEach((w) => (w.closest('.agr-li') || w).remove());
          process(card, asin);
        };
      });
    }
  }

  function scan(root = document) {
    const links = root.matches?.('a[href*="/pd/"]') ? [root] : [...(root.querySelectorAll?.('a[href*="/pd/"]') || [])];
    links.forEach((a) => {
      if (seen.has(a) || a.closest('.agr-wrap')) return;
      seen.add(a);
      const asin = asinOf(a);
      if (!asin) return;
      const card = cardFor(a, asin);
      // pin real list rows only (not recommendation carousels); only takes effect on /library pages
      if (card?.matches('li.productListItem, [id^="adbl-library-content-row-"]')) pin(asin);
      if (!card || pending.has(card) || card.querySelector('.agr-badge')) return;
      // skip tiny nav/menu links
      if (a.closest('header, nav, footer, [role="navigation"]')) return;
      pending.set(card, asin);
      observed.add(card);
      io.observe(card);
    });
  }

  function runScan(roots) {
    asinMemo = new Map();
    try { roots.forEach((r) => r.isConnected && scan(r)); }
    finally { asinMemo = null; }
    pruneObserved();
  }

  runScan([document.body]);

  // Re-scan only what the page added (not the whole page), and ignore our own badges, labels and panel.
  const OUR_NODES = '.agr-wrap, .agr-li, .agr-tip';
  let addedRoots = new Set();
  let needPrune = false;
  let scanTimer = null;
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || n.closest(OUR_NODES)) continue;
        addedRoots.add(n);
      }
      if (m.removedNodes.length && observed.size) needPrune = true;
    }
    if ((addedRoots.size || needPrune) && !scanTimer) {
      scanTimer = setTimeout(() => {
        scanTimer = null;
        needPrune = false;
        const roots = addedRoots.size > 300 ? [document.body] : [...addedRoots];
        addedRoots = new Set();
        // drop roots that sit inside another root, so nothing is scanned twice
        runScan(roots.filter((r) => !roots.some((o) => o !== r && o.contains(r))));
      }, 300);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
