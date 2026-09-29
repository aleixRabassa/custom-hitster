# Review: Lighthouse performance audit

**Date:** 2026-09-29 · **Audited commit:** `5b181c4` (production bundle hashes checked against a local build of
the same commit: `index-Cithw59T.js`, `gestures-B4SHdzLK.js`, identical) · **Tool:** Lighthouse 13.5.0 CLI,
mobile form factor, simulated throttling (defaults), headless Chrome, strictly sequential runs.

## Summary

- **Home and the privacy page were already at 100.** Nothing on either route justified a change.
- **The share-link route was the problem:** Performance **84** (79–84), with **~620 ms of Total Blocking Time**
  (TBT) on every run, all in fast-CPU mode.
- **The cause was one long task: generating the card's QR codes as PNGs.** `qrcode.toDataURL` draws each code
  onto a canvas and PNG-encodes it on the main thread, and the current card's code and the preloaded next card's
  code ran back to back in a single task.
- **Implemented:** the card's QR is now rendered from `qrcode`'s SVG output. In local before/after runs of the
  share route, fast-CPU mode: **Performance 72 → 93, TBT ~950 ms → 3 ms.**
- **Confirmed on production after the deploy (`50c84b8`, §3b): share route 84 → 98 (96–99), TBT ~620 ms → ~107 ms**, and
  that despite 4 of 5 runs landing in slow-CPU mode, against a baseline taken entirely in fast mode.
- **The phone scan needs repeating.** Every past scan was done on the PNG (§4).

## 1. Production baseline — `prod-5b181c4`

Base `https://playlistjitster.vercel.app`, N = 5 per route. The Windows power plan was **Balanced** (not
High-performance), so CPU mode is split by `benchmarkIndex` as the skill prescribes (fast = `> 2500`).

| Route     | URL                                                       | Perf (all) median [min–max] | Fast n · median | Slow n · median | A11y | BP  | SEO |
| --------- | --------------------------------------------------------- | --------------------------- | --------------- | --------------- | ---- | --- | --- |
| `base`    | `/`                                                       | **100** [93–100]            | 4 · 100         | 1 · 93          | 100  | 100 | 100 |
| `share`   | `/?playlist=34cIJlWIX9TEoA8bpI2UBu&seed=0123456789abcdef` | **84** [79–84]              | 5 · 84          | 0 · —           | 100  | 100 | 100 |
| `privacy` | `/privacy.html`                                           | **100** [100–100]           | 5 · 100         | 0 · —           | 100  | 100 | 100 |

All five share runs were in fast-CPU mode, so its 84 is a real fast-CPU number, not CPU bimodality. The one
slow home run (benchmark index 984) scored 93 with 300 ms TBT; the other four scored 98–100.

**Core metrics** (median, fast runs; ms):

| Route     | FCP   | LCP   | TBT     | CLS    | SI    | LCP element                                       |
| --------- | ----- | ----- | ------- | ------ | ----- | ------------------------------------------------- |
| `base`    | 1,275 | 1,428 | 10      | 0      | 1,598 | `<img alt="Playlist Jitster" … src="/logo.webp">` |
| `share`   | 1,239 | 1,912 | **622** | 0.0004 | 1,739 | the card's QR `<img>` (a `data:` URL)             |
| `privacy` | 950   | 950   | 0       | 0      | 950   | a `<p>`                                           |

**Failing audits** (score < 0.9, `failCount` of 5):

| Route     | Audits                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `share`   | `total-blocking-time` 5/5, `max-potential-fid` 5/5, `mainthread-work-breakdown` 5/5, `bootup-time` 5/5, `network-dependency-tree-insight` 5/5, `render-blocking-insight` 5/5, `lcp-breakdown-insight` 1/5, `unused-javascript` 1/5                             |
| `base`    | `lcp-discovery-insight` 5/5, `network-dependency-tree-insight` 5/5, `render-blocking-insight` 5/5; the slow run alone added `total-blocking-time`, `max-potential-fid`, `mainthread-work-breakdown`, `unused-javascript`, `speed-index`, `bf-cache` (1/5 each) |
| `privacy` | `forced-reflow-insight` 1/5                                                                                                                                                                                                                                    |

Priority, by the skill's table: **share is High** (score 50–89). Home and privacy score 100, so anything
on them is Low.

## 2. The share route's long task

Every share run had one long task attributed to `index-*.js` of ~970 ms (e.g. start 1,450 ms, 969 ms). That is
Lighthouse's **simulated** time (observed × the 4× CPU multiplier); in the trace itself it is a single 174 ms
`RunMicrotasks` task in the page's renderer.

A Lighthouse trace has no CPU samples by default. With `--additional-trace-categories=disabled-by-default-v8.cpu_profiler`
the samples appear, and a `vite build --sourcemap` of the same commit (identical chunk hashes) maps them back to
source. Inside the long task:

| Inclusive time (profiler on) | Frame                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| 260 ms                       | `src/components/QrCode.tsx:181` → `qrcode` `toDataURL`                                |
| 224 ms                       | └ `qrcode/lib/renderer/canvas.js` `renderToDataURL` (canvas draw + native PNG encode) |
| 35 ms                        | └ `qrcode/lib/core/qrcode.js` `create` (the QR encoding itself)                       |

So **~85% of the task was drawing to a canvas and PNG-encoding**, not QR maths.

It was **one** task rather than two because both `QrCode` instances on the game screen — the current card and
the next card, preloaded as `CardStack`'s back — continue off the same memoized `loadQrcode()` promise
(`src/game/qrcode-loader.ts`), so both generations run in one microtask checkpoint.

The rest of the route's main-thread time is React rendering spread across many commits (year results arriving,
the session saving to `localStorage`), none of it a long task.

### The fix and why SVG

`qrcode`'s `toString(url, { type: 'svg' })` builds a ~2 kB markup string: no canvas, no PNG encode. The QR
matrix is identical because the encoder is the same. Measured in Chrome on the production `qrcode` chunk:

| Measurement                                                     | PNG (`toDataURL`)    | SVG (`toString`)                         |
| --------------------------------------------------------------- | -------------------- | ---------------------------------------- |
| Warm, one code, median of 20, 1× CPU                            | 8.0 ms               | 0.8 ms                                   |
| Warm, one code, median of 20, 4× CPU                            | 13.7 ms              | 2.3 ms                                   |
| **Cold, two codes (the game screen), 4× CPU**, 5 fresh contexts | **90–127 ms** (≈105) | **41–52 ms** (≈42)                       |
| Payload                                                         | 6.5 kB data URL      | 2.0 kB markup (≈2.6 kB escaped data URL) |

What is left in the cold SVG case is the QR encoding and first-call JIT, which both paths pay.

Alternative considered and **not** built: `toCanvas` + `canvas.toBlob()` + `URL.createObjectURL`. That keeps
the exact PNG pixels, so no re-scan would be needed, and Chrome moves the PNG encode off the main thread. But
it still pays for the canvas draw, adds blob URLs to a cache that never evicts, and saves no bytes. It's the
fallback if the SVG fails the phone scan.

## 3. Local before / after

The share route cannot be audited under `vite preview` (no `/api`). A scratch Node server served `dist/` with
`vercel.json`'s SPA fallback and proxied `/api/*` to production. **Local numbers are comparable only with each
other**: TTFB ≈ 0 and the extra proxy hop change Lantern's simulation, which is why local LCP is ~3 s against
production's 1.9 s. Same server, same port, same machine, back to back.

| Label                        | Build                      | Route   | Fast n · Perf median [min–max] | Fast TBT median | Slow n · Perf | LCP (fast) |
| ---------------------------- | -------------------------- | ------- | ------------------------------ | --------------- | ------------- | ---------- |
| `local-head` + `local-head2` | `5b181c4`                  | `share` | 4 · **72** [72–74]             | ~930 ms         | 6 · 68        | ~3.0 s     |
| `local-svg`                  | `5b181c4` + the SVG change | `share` | 5 · **93** [89–93]             | **3 ms**        | 0 · —         | ~3.1 s     |
| `local-head`                 | `5b181c4`                  | `base`  | 5 · 98 [97–98]                 | 7 ms            | —             | 2.1 s      |
| `local-svg`                  | `5b181c4` + the SVG change | `base`  | 5 · 98 [98–98]                 | 0 ms            | —             | 2.1 s      |

(`local-head2` re-ran the HEAD share route because `local-head` landed only one run in fast mode.)

- `total-blocking-time`, `max-potential-fid` and `bootup-time` went from failing 5/5 to passing 5/5 on the
  share route.
- **LCP did not move**, and that is expected. The LCP element is the QR, and it can't paint until the playlist
  has loaded and the first card's year has come back from `/api/year` (the card-1 gate). That wait is network,
  not CPU.
- The home route is unchanged, as it should be: the landing screen renders no QR.

## 3b. Production after the deploy — `prod-50c84b8`

Base `https://playlistjitster.vercel.app`, N = 5 per route, same runner and settings as §1. The deployed bundle was
checked against a local build of `50c84b8` (`index-qGxCW42h.js`, `GameScreen-Dd1-ROxR.js`). The Balanced power
plan put **most runs in slow-CPU mode this time** (share 4 of 5, privacy 5 of 5), where the §1 baseline was
fast-mode for every share run — so the comparison below is conservative: the "after" is measured on the slower CPU.

| Route     | Before `prod-5b181c4` Perf median [min–max] | After `prod-50c84b8` Perf median [min–max] | Fast n · median | Slow n · median | TBT before → after (median, all runs) | LCP before → after |
| --------- | ------------------------------------------- | ------------------------------------------ | --------------- | --------------- | ------------------------------------- | ------------------ |
| `base`    | 100 [93–100]                                | **100** [100–100]                          | 2 · 100         | 3 · 100         | 16 → 7 ms                             | 1.45 → 1.41 s      |
| `share`   | 84 [79–84] (all fast)                       | **98** [96–99]                             | 1 · 99          | 4 · 98          | **622 → 107 ms**                      | 1.91 → 1.94 s      |
| `privacy` | 100 [100–100]                               | **100** [100–100]                          | 0 · —           | 5 · 100         | 0 → 0 ms                              | 0.95 → 1.13 s      |

- **Share route:** `total-blocking-time` went from failing 5/5 to passing 5/5. The one fast-mode run had 21 ms
  of TBT; the ~100–135 ms on the slow-mode runs is ordinary React rendering on the slower CPU, not the QR.
  `bootup-time` and `mainthread-work-breakdown` still fail 5/5, as the slow-CPU runs would predict.
- **LCP is unchanged, as expected** (§3): the QR paints only once the first card's year arrives.
- **Privacy's LCP rose 0.18 s with an unchanged page.** That is the CPU mode (slow for all five runs), not a
  regression; so is its `max-potential-fid` 5/5 on a 100 score.
- Still failing everywhere, as before: the three insights in §6 (`render-blocking-insight`,
  `network-dependency-tree-insight`, and home's `lcp-discovery-insight`).

## 4. What changed in the repository

- `src/components/QrCode.tsx` — `toString({ type: 'svg' })` wrapped as `data:image/svg+xml;charset=utf-8,` +
  `encodeURIComponent(svg)`. The escaping is required because the markup carries `#` in its fill colours. The
  header now explains the SVG and its measurement; `size` is documented as the intrinsic size rather than a
  bitmap.
- **`src/hooks/usePdfExport.ts` is untouched.** The PDF export keeps `toDataURL`, because jsPDF embeds a raster.
- `src/components/CardHiddenSide.tsx`, `CardStack.tsx`, `src/game/qr-cache.ts`, `src/index.css`,
  `src/index.css.test.ts` — comment updates only. The "`QR_BITMAP_SIZE` must track `--qr-display-size` from
  above" rule is retired, because a vector has no resolution to fall short of. The constant stays at 288 as the
  intrinsic size and cache key.
- **Tests:** the card-QR double in seven files (`App`, `Card`, `CardHiddenSide`, `CardStack`, `GameScreen`,
  `QrCode`, `QrCode.load-failure`) now mocks `toString` rather than `toDataURL`. `DeckActions.test.tsx` keeps
  `toDataURL`, since it runs the PDF path. New test: `QrCode.test.tsx` "should generate the code as an SVG",
  pinning `type: 'svg'` — the one thing a double cannot see, since `toString` without it returns text.
- **Docs:** `AGENTS.md` (a new block on the SVG QR, plus two sentences corrected), `docs/architecture.md` §3,
  `docs/development.md` §5 (new manual-check table), `docs/agent_findings.md` (dated entry).

**Trap worth knowing:** a test double mocked as `{ toDataURL }` still has `Object.prototype.toString`, which
returns `"[object Object]"` without throwing. A missed file would render a garbage `src` and still pass.

**Checks:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (59 files, 986 tests) and `pnpm build` all pass. The first
`pnpm test` run showed 13 `Timeout waiting for worker to respond` errors with every assertion green; this is the
worker-startup flake already recorded in `agent_findings.md`, and a clean re-run passed.

## 5. Owed, and not done here

| #   | Item                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Scan the SVG QR with a real phone**, at the ceiling card and at the 240px floor card. The encoder and matrix are unchanged, but the camera now sees a browser-rasterised vector at a fractional module size, and every recorded scan was of the PNG. Row 1 of the new table in `development.md` §5. |
| 2   | ~~Re-run the production audit after the deploy~~ — **done 2026-09-29**, §3b.                                                                                                                                                                                                                          |
| 3   | The production audit of the **game screen after a swipe** (the next card's code is generated mid-game). Lighthouse audits only the load; the SVG change removes the same cost there too, unmeasured.                                                                                                  |

## 6. Findings recorded but not acted on

All of these are Low priority by the skill's table (they sit on routes already scoring 100, or they are
Lighthouse _insights_ rather than scored audits).

- **`lcp-discovery-insight` on home, 5/5.** The logo is discoverable only once React renders, so a
  `<link rel="preload" as="image" href="/logo.webp" fetchpriority="high">` in `index.html` would fix it. **Not
  done**: `index.html` is shared by every route, and a share link never shows the logo (it deals straight past
  the welcome screen). So the preload would spend 13 kB competing with the JS on exactly the route that needs
  the bandwidth, to improve a route already at 100.
- **`render-blocking-insight`, 5/5 on home and share.** The one stylesheet (7.3 kB transferred) blocks first
  paint. Inlining it would mean a build step and would push `index.html`, the document that must stay small,
  past 30 kB. Not worth it at a 100 score.
- **`network-dependency-tree-insight`, 5/5.** `index` → `gestures` is a two-level chain, and Vite already
  emits a `modulepreload` for `gestures`. Nothing cheap left.
- **`unused-javascript`** fails 1/5 on production and 5/5 locally. `index-*.js` carries
  React, Motion and the three language catalogues; the catalogue decision (all three bundled, no network hop
  before first paint) is recorded in `agent_findings.md` (2026-09-28).
- **`bf-cache` 1/5 and `forced-reflow-insight` 1/5** — single-run occurrences, not reproduced.

## Method notes

- **The repo's `unlighthouse` skill was written for another project** (its route table is
  `calculadorapatrimonio.vercel.app`'s hash routes). Its procedure was followed; its targets were replaced by
  `/`, a share link and `/privacy.html`. Its `scripts/lighthouse-audit.mjs` does not exist in this repo; a scratch
  runner with the same outputs was used.
- **Lighthouse 13.5.0 on Windows exits non-zero after every run** (chrome-launcher `EPERM` removing its temp
  profile) _after_ writing the report. The runner therefore judges a run by its report file, validating
  `finalDisplayedUrl`, `runtimeError` and a non-null Performance score. One home run returned `NO_FCP` and was
  re-run.
- **Raw reports and summaries were kept in the session scratchpad, not in the repo** (`uh-results/` is not a
  tracked path here). Labels: `prod-5b181c4`, `local-head`, `local-head2`, `local-svg`, `prod-50c84b8`.
