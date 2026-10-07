---
name: unlighthouse
description: Run per-route Lighthouse audits (Lighthouse CLI, one route at a time) on the deployed app, aggregate N runs per route with fast/slow CPU medians, and write a dated review under docs/reviews/. Raw reports and summaries stay in the session scratchpad. Use when asked to "run lighthouse", "audit performance", "lighthouse audit", or "unlighthouse".
license: MIT
metadata:
  author: aleix-rabassa
  version: "2.0"
---

# Lighthouse Audit

Audit every route of the app with the **Lighthouse CLI** and write the results up as a dated review in `docs/reviews/` (the previous one is `docs/review.unlighthouse.md`; follow its shape).

> **Do not use Unlighthouse for this app.** It can't audit hash routes: 0.18.1 has no `--no-discovery` / `--routes` flags and **silently ignores them**, so every "per-route" run measures `/` (= `#inicio`). `--urls "/#ingresos"` fails with "Failed to queue routes for scanning", and `unlighthouse-ci` via npx fails with `ERR_MODULE_NOT_FOUND …/median-run.js`. The skill keeps its name only for its trigger words.

## Targets

| Route key | URL (default base `https://playlistjitster.vercel.app`) |
|-----------|-------------------------------------------------------|
| `base` | `<base>/` |
| `share` | `<base>/?playlist=34cIJlWIX9TEoA8bpI2UBu&seed=0123456789abcdef` |
| `privacy` | `<base>/privacy.html` |

Other bases:
- **Vercel preview deployment** (`https://<deployment>.vercel.app`): comparable with production (same CDN/TTFB). It must be publicly reachable. Behind Deployment Protection, Lighthouse audits the login page.
- **Local build**: `vite preview` (`http://localhost:4173`) or `npx -y serve@14 <dist> -l 4178` (gzip on; `vite preview` has none). **Not comparable** with Vercel runs: TTFB ≈ 0 changes Lantern's simulation. Label it (e.g. `local-…`) and compare only local-vs-local, before/after.

**Label**: a short name for the audited state (`prod-<sha>`, `local-head`). It prefixes every output path. Never reuse a label within one review; past labels are listed in the previous review's method notes.

## 1. Verify what's deployed

Production may lag the branch. Before auditing, check that the target serves the bundle you expect:

```bash
curl -s https://playlistjitster.vercel.app/ | grep -o 'assets/[^"]*\.js'
# compare with the local build
pnpm build && grep -o 'assets/[^"]*\.js' dist/index.html
```

Hashes differ → the deployment is not the commit you think. Wait for the deploy, audit a preview URL, or state in the report which commit was really measured (identify it by bundle contents if needed).

## 2. Run the audits

**Strictly sequential**: one Lighthouse (one Chrome) at a time. Parallel runs compete for CPU and corrupt TBT. Don't run e2e / builds / other agents' Chrome at the same time.

**N = 5–10 runs per route** (10 when comparing against a baseline). Defaults: mobile form factor, simulated throttling. Don't change them; the baselines use them.

Before starting, prefer the Windows **High-performance** power plan (see CPU bimodality below).

### Runner

There is no runner script in this repo. Write a scratch runner in the session scratchpad that loops the
manual command below sequentially per route and run, validates each report (step 3), and writes:
- `<scratchpad>/uh-results/<label>-<route>/run-N.report.{json,html}`
- `<scratchpad>/uh-results/<label>-summary.json`: per route key:
  - `all`, `fastTBT`, `slowTBT`, each `{ n, Pmin, Pmax, P, A, BP, SEO, FCP, LCP, TBT, CLS, SI, TTI }` (medians; times in ms)
  - `fastRuns`: report files classified as fast (`benchmarkIndex > 2500`)
  - `failCount`: audit id → number of runs where the score was < 0.9

Raw reports and summaries stay in the session scratchpad — `uh-results/` is not ignored in this repo, so never write them under `docs/`. Only the review file is committed.

### Manual fallback (one route, one run)

```bash
mkdir -p <scratchpad>/uh-results/prod-share
npx -y lighthouse@13.5.0 "https://playlistjitster.vercel.app/?playlist=34cIJlWIX9TEoA8bpI2UBu&seed=0123456789abcdef" \
  --output=json --output=html \
  --output-path=<scratchpad>/uh-results/prod-share/run-1 \
  --chrome-flags="--headless=new" --quiet
# → run-1.report.json + run-1.report.html (Lighthouse appends the suffixes)

node -e "
const r = JSON.parse(require('fs').readFileSync('<scratchpad>/uh-results/prod-share/run-1.report.json','utf8'));
const c = r.categories, a = r.audits, s = k => Math.round(c[k].score*100);
console.log({
  url: r.finalDisplayedUrl, benchmarkIndex: r.environment.benchmarkIndex,
  P: s('performance'), A: s('accessibility'), BP: s('best-practices'), SEO: s('seo'),
  FCP: a['first-contentful-paint'].numericValue, LCP: a['largest-contentful-paint'].numericValue,
  TBT: a['total-blocking-time'].numericValue, CLS: a['cumulative-layout-shift'].numericValue,
  failing: Object.values(a).filter(x => x.score !== null && x.score < 0.9).map(x => x.id),
});"
```

## 3. Validate every report (mandatory)

- **`finalDisplayedUrl` must match the requested path and query** (`/privacy.html`, `?playlist=…&seed=…`). Otherwise discard the report and re-run it. This check is what exposed the Unlighthouse trap.
- **Record `environment.benchmarkIndex`** for every run; it decides fast/slow classification.
- A run with a `runtimeError` or a null Performance score is discarded and re-run.

## 4. CPU bimodality

On this machine (i7-13620H, Balanced power plan) Windows sometimes schedules Chrome on efficiency cores. `benchmarkIndex` is then bimodal (~950 vs ~3,300), and TBT (and so Performance) swings by ~20 points between modes. Within one mode the variance is ±2–3 points.

- **Fast** = `benchmarkIndex > 2500`; **slow** = the rest.
- Report the fast median, the slow median, and the all-runs median [min–max] separately.
- **Compare against a baseline only within the same CPU mode.** If a route has no fast run, say "n/a (no clean fast run)" rather than mixing modes.
- To get more fast runs: switch to the High-performance power plan, or pin Chrome to the P-cores.

## 5. Write the review

Write `docs/reviews/review.lighthouse.<YYYY-MM-DD>.md`, in the shape of `docs/review.unlighthouse.md`:

1. **Header**: date, audited commit (as verified in step 1), base URL, label, N.
2. **Scores Summary** table: the new label beside the previous review's baseline, plus the slow/all median [min–max]. Keep A11y / BP / SEO. Footnote anything non-comparable (local base, no fast run, different Lighthouse version).
3. **Core metrics** table: FCP, LCP, TBT, CLS, SI, TTI per route as `fast / slow median`, plus the LCP element (in LH 13.5 it's in `audits['lcp-breakdown-insight'].details`; there's no `largest-contentful-paint-element` audit).
4. **Failing audits**: per route, list the audits with their `failCount` (e.g. `unused-javascript 10/10`). Audits failing on every route go into the cross-route section once.
5. **Map to fixes**: link each failure to an existing item (CR/H/M/L IDs) or add a new one with evidence (file:line), cause, affected metric and fix. Mark items whose failure disappeared as verified. Priority:

| Lighthouse score | Priority |
|------------------|----------|
| < 50 | Critical |
| 50 – 89 | High |
| 90 – 99 | Medium |
| 100 | Low (only if it's an easy win) |

## Checklist

- [ ] Choose base URL and label; note whether the base is comparable with the baseline
- [ ] Verify the deployed bundle matches the expected commit
- [ ] High-performance power plan; no other Chrome/e2e/build running
- [ ] Run N = 5–10 sequential runs per route
- [ ] Every report validated (`finalDisplayedUrl`, `benchmarkIndex`); bad runs re-run
- [ ] `<label>-summary.json` written; fast and slow medians reported separately
- [ ] Review written (scores vs previous baseline), failing audits with `failCount`, fixes mapped

## Common issues

- **Unlighthouse flag trap**: unknown flags are ignored without warning, so a "per-route" scan really audits `/`. Use the Lighthouse CLI.
- **Non-zero exit on Windows**: Lighthouse 13.5.0 exits non-zero after every run (chrome-launcher `EPERM` removing its temp profile) *after* writing the report. Judge a run by its report file (step 3), not the exit code.
- **The share route locally** needs `/api` proxied (`vite preview` has no functions); local numbers compare only with each other.
- **Query-string routes**: crawlers don't discover them. Pass the full URL to Lighthouse and validate `finalDisplayedUrl`. Always quote the URL in the shell (the share URL contains `&`).
- **Bimodal CPU**: see section 4. A sudden ±20-point Performance swing with an unchanged bundle is almost always the CPU mode; check `benchmarkIndex` before concluding anything.
- **Chrome / port leftovers**: an interrupted run can leave headless Chrome processes behind that eat CPU and hold debugging ports. On Windows, kill them before re-running:
  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object CommandLine -match 'headless' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
- **Windows paths**: use forward slashes in `--output-path`. The fallback uses bash `\` continuations, so in PowerShell put the lighthouse command on one line. Create the output dir first (`mkdir -p`), because Lighthouse may not create missing parent directories.
- **`--output-path` naming**: with multiple `--output` formats Lighthouse appends `.report.json` / `.report.html` to the given path. Pass `…/run-1`, not `…/run-1.json`.
- **Production sourcemaps**: `.map` files return 403 on Vercel, so `valid-source-maps` fails regardless of `build.sourcemap`. It's unscored, so ignore it.
