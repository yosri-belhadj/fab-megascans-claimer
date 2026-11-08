# Fab Megascans Claimer

A browser-console script that claims every **free** Quixel Megascans listing on [Fab](https://www.fab.com) for the account you are logged into, so you don't have to click "Add to library" thousands of times.

> **Unofficial.** This project is not affiliated with or endorsed by Epic Games, Fab or Quixel. It calls Fab's internal web API, which can change at any time. Use it at your own risk and make sure you follow Fab's terms of service.

## Why

[Quixel announced](https://quixel.com/news/update-megascans-are-going-free-again) that the full Megascans library is free on Fab. Claiming it item by item takes forever; this script does it in the same way the "Add to library" button does.

## How to use

1. Log in at <https://www.fab.com> with your Epic account and accept the latest terms (claiming any free asset by hand once is enough).
2. Open <https://www.fab.com/sellers/Quixel%20Megascans> in the same tab.
3. Press `F12` and open the **Console** tab. If Chrome blocks pasting, type `allow pasting` and press Enter.
4. **Test run first:** open `claim.js`, set `MAX_ITEMS = 3`, paste the whole file into the Console and press Enter. Check that 3 items appear in your Fab library.
5. Set `MAX_ITEMS = Infinity`, reload the page, paste it again and let it run.
6. **Keep the tab open** (and the computer awake) until the console prints `DONE`. A full run took roughly an hour in testing (about 12,700 items).

### Checking progress

Run this in the Console of the same tab:

```js
JSON.stringify([__fab.claimed, __fab.skippedNotFree, __fab.failed.length, __fab.done, __fab.stopped])
```

### If it stops

The script prints a `RESUME` line after every page. Copy those values into `RESUME_FILTER_INDEX` and `RESUME_CURSOR` at the top of `claim.js` and run it again. Re-running is safe: it never buys anything and does not duplicate items you already own.

## What it does

- Searches the **Quixel Megascans** seller by listing type (material, decal, brush, 3d-model, hdri) and then does one unfiltered sweep for anything missed.
- Looks at each listing's licenses and claims **only offers priced at 0**, preferring the professional license. Items that are not free are counted and skipped; the script never attempts a purchase.
- Retries on rate limits (429) and server errors (5xx) with backoff, and claims 4 items in parallel by default.
- Stops immediately on 401/403 (not logged in / not authorized).
- Sends requests only to `www.fab.com`, using your existing session. Nothing is sent anywhere else, and it never reads or transmits your password.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `MAX_ITEMS` | `Infinity` | Stop after this many claims (use `3` for a test). |
| `DRY_RUN` | `false` | List what would be claimed without claiming. |
| `CONCURRENCY` | `4` | Parallel claims. Lower it if you get 429 errors. |
| `PAUSE_BETWEEN_PAGES_S` | `2` | Seconds between result pages. |
| `RESUME_FILTER_INDEX` / `RESUME_CURSOR` | `0` / `null` | Where to continue after an interruption. |

## Known limitations

- Fab's search cannot always page through the whole catalogue, so a few items may be missed. Check your library count afterwards and re-run if needed.
- Some assets are not free (they have no price-0 offer) and are skipped.
- Fab may change its API or add bot protection, which would break the script. Issues and pull requests are welcome.

## License

MIT. Derived from [wikiti's Fab script](https://gist.github.com/wikiti/f64aa14ee65fd194467d8c8944ed8372) (Copyright 2024 Daniel Herzog, MIT). See [LICENSE](LICENSE).
