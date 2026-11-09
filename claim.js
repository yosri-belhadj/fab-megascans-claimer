// Fab Megascans Claimer
// Claims every free Quixel Megascans listing on Fab for the account you are logged into.
//
// Usage: log in at https://www.fab.com, open https://www.fab.com/sellers/Quixel%20Megascans,
// open DevTools (F12) -> Console, paste this whole file and press Enter.
//
// Why it is built this way: Fab's search stops after roughly 5,000 results per query, and the
// library is far bigger than that. So the script lists items with many different sort orders and
// category filters, and claims each new item as soon as it is found.
//
// Derived from wikiti's MIT-licensed Fab script (Copyright 2024 Daniel Herzog); see LICENSE.

(async () => {
  // ---------- Settings ----------
  const SELLER = 'Quixel Megascans';
  const MAX_ITEMS = Infinity;  // set to 3 for a quick test run, then back to Infinity
  const DRY_RUN = false;       // true = list what would be claimed, claim nothing
  const CLAIM_WORKERS = 6;     // parallel claims; lower it if you see rate-limit errors
  const SEARCH_WORKERS = 4;    // parallel searches
  const LISTING_TYPES = ['material', '3d-model', 'decal', 'brush', 'hdri'];
  // ---------- End settings ----------

  if (window.__fab && !window.__fab.finished && !window.__fab.error) {
    return console.warn('-> A run is already in progress in this tab. Reload the page to start over.');
  }

  const S = (window.__fab = {
    phase: 'searching', seen: new Set(), queue: [], claimed: 0, notFree: 0,
    failed: [], pages: 0, finished: false, error: null,
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const csrf = () => {
    const c = document.cookie.split('; ').find((p) => /csrf/i.test(p.split('=')[0]));
    return c ? decodeURIComponent(c.split('=').slice(1).join('=')) : '';
  };

  class HttpError extends Error {
    constructor(status, msg) { super(msg); this.status = status; }
  }

  // fetch with retry/backoff on 429 and 5xx; auth errors stop the whole run
  const api = async (path, { method = 'GET', form } = {}) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`https://www.fab.com/i/${path}`, {
        method, body: form, credentials: 'include',
        headers: { accept: 'application/json, text/plain, */*', 'x-csrftoken': csrf() },
      });
      if (res.ok) return method === 'GET' ? res.json() : res.text();
      if (res.status === 401 || res.status === 403) throw new HttpError(res.status, `HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) throw new HttpError(res.status, `HTTP ${res.status}`);
      await sleep(2000 * (attempt + 1));
    }
    throw new HttpError(0, 'retries exhausted');
  };

  const stop = (e) => { if (!S.error) S.error = String(e.message || e); };
  const isAuth = (e) => e.status === 401 || e.status === 403;
  const seller = `seller=${encodeURIComponent(SELLER)}`;

  // Walk every page of one search query; queue items we have not seen yet
  const walk = async (query, categories, type) => {
    let cursor = null;
    do {
      if (S.error || S.seen.size >= MAX_ITEMS) return;
      const page = await api(`listings/search?${query}${cursor ? `&cursor=${cursor}` : ''}`);
      S.pages++;
      for (const item of page.results || []) {
        if (categories && item.category?.slug) categories.add(`${type}|${item.category.slug}`);
        if (!S.seen.has(item.uid)) {
          if (S.seen.size >= MAX_ITEMS) return;
          S.seen.add(item.uid);
          S.queue.push({ uid: item.uid, title: item.title });
        }
      }
      cursor = page.cursors?.next ?? null;
    } while (cursor);
  };

  const runPool = async (tasks, workers) => {
    const q = [...tasks];
    await Promise.all(Array.from({ length: workers }, async () => {
      while (q.length && !S.error) {
        try { await q.shift()(); } catch (e) { if (isAuth(e)) stop(e); else S.failed.push({ id: 'search', error: String(e.message) }); }
      }
    }));
  };

  // Only free offers (price 0); prefer the professional license, else the first free one
  const pickOffer = (item) => {
    const free = (item.licenses || []).filter((l) => (l.priceTier?.price ?? 0) === 0);
    return (free.find((l) => l.slug === 'professional') || free[0])?.offerId;
  };

  let searching = true;
  const claimWorker = async () => {
    while (!S.error) {
      const it = S.queue.shift();
      if (!it) { if (!searching) break; await sleep(300); continue; }
      try {
        const item = await api(`listings/${it.uid}`);
        const offerId = pickOffer(item);
        if (!offerId) { S.notFree++; continue; } // not free: never attempt to buy
        if (!DRY_RUN) {
          const form = new FormData();
          form.append('offer_id', offerId);
          await api(`listings/${it.uid}/add-to-library`, { method: 'POST', form });
        }
        S.claimed++;
      } catch (e) {
        if (isAuth(e)) { stop(e); break; }
        S.failed.push({ id: it.uid, title: it.title, error: String(e.message) });
      }
    }
  };

  const status = () =>
    `${S.phase} | found ${S.seen.size} | claimed ${S.claimed} | not free ${S.notFree} | failed ${S.failed.length} | pages ${S.pages}`;
  const ticker = setInterval(() => console.log(`-> ${status()}`), 15000);

  console.log('-> Starting. Keep this tab open until it prints DONE. Type  __fab  in the console to inspect.');
  const claimers = Array.from({ length: CLAIM_WORKERS }, claimWorker);

  try {
    // Pass 1: each listing type with many sort orders. Each ordering reaches a different
    // slice of the library, and the results also reveal the category names.
    const sorts = ['', 'sort_by=title', 'sort_by=-title', 'sort_by=firstPublishedAt',
      'sort_by=-firstPublishedAt', 'sort_by=publishedAt', 'sort_by=-publishedAt', 'sort_by=-relevance'];
    const categories = new Set();
    S.phase = 'pass 1/3';
    await runPool(LISTING_TYPES.flatMap((t) => sorts.map((s) => () =>
      walk(`${seller}&listing_types=${t}${s ? `&${s}` : ''}`, categories, t))), SEARCH_WORKERS);

    // Pass 2: split every type by category so each query is small enough to list completely
    S.phase = 'pass 2/3';
    const slices = [...categories].map((x) => x.split('|'));
    const sorts2 = ['', 'sort_by=title', 'sort_by=-title', 'sort_by=firstPublishedAt', 'sort_by=-firstPublishedAt'];
    await runPool(slices.flatMap(([t, c]) => sorts2.map((s) => () =>
      walk(`${seller}&listing_types=${t}&categories=${c}${s ? `&${s}` : ''}`, null, t))), SEARCH_WORKERS);

    // Pass 3: unfiltered sweep for anything the filters missed
    S.phase = 'pass 3/3';
    await runPool(sorts.map((s) => () => walk(`${seller}${s ? `&${s}` : ''}`, null, '')), SEARCH_WORKERS);
  } catch (e) { stop(e); }

  searching = false;
  S.phase = 'claiming the rest';
  await Promise.all(claimers);
  clearInterval(ticker);

  S.finished = !S.error;
  S.phase = S.error ? 'stopped' : 'done';
  if (S.error) {
    console.error(`-> Stopped: ${S.error}`);
    if (/40[13]/.test(S.error)) console.error('-> Not authorized. Log in at fab.com, accept the latest terms, then re-run.');
  } else {
    console.log(`-> DONE | ${status()}`);
    if (S.failed.length) console.log('-> Failed items: type  __fab.failed  in the console.');
  }
})();
