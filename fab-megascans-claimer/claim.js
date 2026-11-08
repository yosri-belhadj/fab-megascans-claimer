// Fab Megascans Claimer
// Claims every free Quixel Megascans listing on Fab for the account you are logged into.
//
// Usage: log in at https://www.fab.com, open https://www.fab.com/sellers/Quixel%20Megascans,
// open DevTools (F12) -> Console, paste this whole file and press Enter.
//
// Derived from wikiti's MIT-licensed Fab script (Copyright 2024 Daniel Herzog),
// rewritten with retries, limited concurrency, free-offer-only claiming and progress tracking.
// See LICENSE and README.md.

(async () => {
  // ---------- Settings ----------
  const SELLER = 'Quixel Megascans';
  const MAX_ITEMS = Infinity;   // set to 3 for a quick test run, then back to Infinity
  const DRY_RUN = false;        // true = list what would be claimed, claim nothing
  const CONCURRENCY = 4;        // parallel claims; lower it if you see 429 errors
  const PAUSE_BETWEEN_PAGES_S = 2;
  const MAX_RETRIES = 4;
  const RESUME_FILTER_INDEX = 0; // to resume, use the values printed as "RESUME"
  const RESUME_CURSOR = null;

  // Search is split by listing type because one big query cannot be paged through fully.
  // The last, empty entry is an unfiltered sweep that catches anything the others missed.
  const FILTERS = [
    'listing_types=material',
    'listing_types=decal',
    'listing_types=brush',
    'listing_types=3d-model',
    'listing_types=hdri',
    '',
  ];
  // ---------- End settings ----------

  if (window.__fab && !window.__fab.done && !window.__fab.stopped) {
    return console.warn('-> A run is already in progress in this tab. Reload the page to start over.');
  }

  const BASE = 'https://www.fab.com/i/listings';
  const S = (window.__fab = {
    claimed: 0, skippedNotFree: 0, alreadyOwned: 0, failed: [],
    pages: 0, filterIndex: RESUME_FILTER_INDEX, pageCursor: RESUME_CURSOR,
    done: false, stopped: null, seen: new Set(),
  });

  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

  // Find the CSRF token (cookie containing "csrf"), else a <meta> tag
  const csrf = () => {
    const c = document.cookie.split('; ').find((p) => /csrf/i.test(p.split('=')[0]));
    if (c) return decodeURIComponent(c.split('=').slice(1).join('='));
    return document.querySelector('meta[name*="csrf" i]')?.content || '';
  };

  class HttpError extends Error {
    constructor(status, msg) { super(msg); this.status = status; }
  }

  // fetch with retry/backoff on 429 and 5xx
  const request = async (path, { method = 'GET', form } = {}) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE}/${path}`, {
        method,
        credentials: 'include',
        headers: { accept: 'application/json, text/plain, */*', 'x-csrftoken': csrf() },
        body: form,
      });
      if (res.ok) return method === 'GET' ? res.json() : res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new HttpError(res.status, `HTTP ${res.status} on ${method} ${path.split('?')[0]}`);
      }
      await sleep(2 ** attempt * 2); // 2s, 4s, 8s, 16s
    }
  };

  // Only free offers (price 0). Prefer the professional license, else the first free one.
  const pickOffer = (item) => {
    const free = (item.licenses || []).filter((l) => (l.priceTier?.price ?? 0) === 0);
    return (free.find((l) => l.slug === 'professional') || free[0])?.offerId;
  };

  const claim = async (li) => {
    if (S.seen.has(li.uid)) return;
    S.seen.add(li.uid);
    if (S.claimed >= MAX_ITEMS) return;
    try {
      const item = await request(li.uid);
      const offerId = pickOffer(item);
      if (!offerId) { S.skippedNotFree++; return; } // not free: never attempt to buy
      if (DRY_RUN) { S.claimed++; console.log(`   [dry run] ${li.title}`); return; }
      const form = new FormData();
      form.append('offer_id', offerId);
      await request(`${li.uid}/add-to-library`, { method: 'POST', form });
      S.claimed++;
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw e; // auth problem: stop everything
      if (e.status === 409) { S.alreadyOwned++; return; }
      S.failed.push({ id: li.uid, title: li.title, error: e.message });
    }
  };

  // Simple worker pool
  const runPool = async (items) => {
    const queue = [...items];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await claim(queue.shift()); })
    );
  };

  const status = () =>
    `claimed ${S.claimed} | not free ${S.skippedNotFree} | already owned ${S.alreadyOwned} | failed ${S.failed.length} | page ${S.pages}`;

  console.log('-> Starting. Keep this tab open until it prints DONE.');
  try {
    for (let f = RESUME_FILTER_INDEX; f < FILTERS.length; f++) {
      S.filterIndex = f;
      let cursor = f === RESUME_FILTER_INDEX ? RESUME_CURSOR : null;
      do {
        if (S.claimed >= MAX_ITEMS) break;
        S.pageCursor = cursor;
        S.pages++;
        const q = `search?seller=${encodeURIComponent(SELLER)}${FILTERS[f] ? '&' + FILTERS[f] : ''}${cursor ? `&cursor=${cursor}` : ''}`;
        const page = await request(q);
        await runPool(page.results || []);
        const next = page.cursors?.next ?? null;
        if (next && next === cursor) throw new Error('Cursor loop: the API returned the same cursor twice');
        cursor = next;
        console.log(`-> [filter ${f}] ${status()}  (RESUME: filter ${f}, cursor ${JSON.stringify(cursor)})`);
        await sleep(PAUSE_BETWEEN_PAGES_S);
      } while (cursor);
    }
    S.done = true;
    console.log(`-> DONE | ${status()}`);
    if (S.failed.length) console.log('-> Failed items: type  __fab.failed  in the console.');
  } catch (e) {
    S.stopped = e.message;
    console.error(`-> Stopped: ${e.message}`);
    if (e.status === 401 || e.status === 403) {
      console.error('-> Not authorized. Make sure you are logged in at fab.com and have accepted the latest terms, then re-run.');
    }
    console.error(`-> To resume, set RESUME_FILTER_INDEX = ${S.filterIndex} and RESUME_CURSOR = ${JSON.stringify(S.pageCursor)} at the top.`);
  }
})();
