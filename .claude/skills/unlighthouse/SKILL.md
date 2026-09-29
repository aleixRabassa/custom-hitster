---
name: unlighthouse
description: Run per-route Lighthouse audits (Lighthouse CLI, one hash route at a time) on the deployed app, aggregate N runs per route with fast/slow CPU medians, and update the current plan docs/plans/plan.unlighthouse-improvements.md. Raw reports go to docs/plans/uh-results/<label>-<route>/run-N.report.{json,html}, the aggregate to docs/plans/uh-results/<label>-summary.json. Use when asked to "run lighthouse", "audit performance", "lighthouse audit", or "unlighthouse".
license: MIT
metadata:
  author: aleix-rabassa
  version: "2.0"
---

# Lighthouse Audit

Audit every hash route of the app with the **Lighthouse CLI** and turn the results into the prioritized plan at `docs/plans/plan.unlighthouse-improvements.md`.

> **Do not use Unlighthouse for this app.** It can't audit hash routes: 0.18.1 has no `--no-discovery` / `--routes` flags and **silently ignores them**, so every "per-route" run measures `/` (= `#inicio`). `--urls "/#ingresos"` fails with "Failed to queue routes for scanning", and `unlighthouse-ci` via npx fails with `ERR_MODULE_NOT_FOUND …/median-run.js`. The skill keeps its name only for its trigger words.

## Targets

| Route key | URL (default base `https://calculadorapatrimonio.vercel.app`) |
|-----------|-------------------------------------------------------------|
| `base` | `<base>/` |
| `inicio` | `<base>/#inicio` |
| `ingresos` | `<base>/#ingresos` |
| `hipoteca` | `<base>/#hipoteca` |
| `inversion` | `<base>/#inversion` |
| `patrimonio` | `<base>/#patrimonio` |

Other bases:
- **Vercel preview deployment** (`https://<deployment>.vercel.app`): comparable with production (same CDN/TTFB). It must be publicly reachable. Behind Deployment Protection, Lighthouse audits the login page.
- **Local build**: `vite preview` (`http://localhost:4173`) or `npx -y serve@14 <dist> -l 4178` (gzip on; `vite preview` has none). **Not comparable** with Vercel runs: TTFB ≈ 0 changes Lantern's simulation. Label it (e.g. `local-…`) and compare only local-vs-local, before/after.

**Label**: a short name for the audited state (`head4`, `pr12-preview`, `local-cr1`). It prefixes every output path. Never reuse an existing label (`head2`, `head3`, … are in `docs/plans/uh-results/`).

## 1. Verify what's deployed

Production may lag the branch. Before auditing, check that the target serves the bundle you expect:

```bash
curl -s https://calculadorapatrimonio.vercel.app/ | grep -o 'assets/[^"]*\.js'
# compare with the local build
npm run build && grep -o 'assets/[^"]*\.js' dist/index.html
```

Hashes differ → the deployment is not the commit you think. Wait for the deploy, audit a preview URL, or state in the report which commit was really measured (identify it by bundle contents if needed).

## 2. Run the audits

**Strictly sequential**: one Lighthouse (one Chrome) at a time. Parallel runs compete for CPU and corrupt TBT. Don't run e2e / builds / other agents' Chrome at the same time.

**N = 5–10 runs per route** (10 when comparing against a baseline). Defaults: mobile form factor, simulated throttling. Don't change them; the baselines use them.

Before starting, prefer the Windows **High-performance** power plan (see CPU bimodality below).

### Runner script (preferred)

```bash
node scripts/lighthouse-audit.mjs --base https://calculadorapatrimonio.vercel.app --label head4 --runs 10
node scripts/lighthouse-audit.mjs --base http://localhost:4173 --label local-cr1 --runs 5 --routes inicio,ingresos
node scripts/lighthouse-audit.mjs --aggregate-only --label head4   # re-aggregate existing reports
```

It runs `lighthouse@13.5.0` sequentially per route and run, validates each report (step 3), and writes:
- `docs/plans/uh-results/<label>-<route>/run-N.report.{json,html}`
- `docs/plans/uh-results/<label>-summary.json`: per route key:
  - `all`, `fastTBT`, `slowTBT`, each `{ n, Pmin, Pmax, P, A, BP, SEO, FCP, LCP, TBT, CLS, SI, TTI }` (medians; times in ms)
  - `fastRuns`: report files classified as fast (default `--fast-by bench`: `benchmarkIndex > 2500`)
  - `failCount`: audit id → number of runs where the score was < 0.9

`docs/plans/uh-results/` is gitignored. Only the plan file is committed.

### Manual fallback (one route, one run)

```bash
mkdir -p docs/plans/uh-results/head4-ingresos
npx -y lighthouse@13.5.0 "https://calculadorapatrimonio.vercel.app/#ingresos" \
  --output=json --output=html \
  --output-path=docs/plans/uh-results/head4-ingresos/run-1 \
  --chrome-flags="--headless=new" --quiet
# → run-1.report.json + run-1.report.html (Lighthouse appends the suffixes)

node -e "
const r = JSON.parse(require('fs').readFileSync('docs/plans/uh-results/head4-ingresos/run-1.report.json','utf8'));
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

- **`finalDisplayedUrl` must end with the requested hash** (`#ingresos` …). For `base` it must have no hash or end in `#inicio`. Otherwise discard the report and re-run it. This check is what exposed the Unlighthouse trap.
- **Record `environment.benchmarkIndex`** for every run; it decides fast/slow classification.
- A run with a `runtimeError` or a null Performance score is discarded and re-run.

## 4. CPU bimodality

On this machine (i7-13620H, Balanced power plan) Windows sometimes schedules Chrome on efficiency cores. `benchmarkIndex` is then bimodal (~950 vs ~3,300), and TBT (and so Performance) swings by ~20 points between modes. Within one mode the variance is ±2–3 points.

- **Fast** = `benchmarkIndex > 2500`; **slow** = the rest (script default `--fast-by bench`).
- **Caveat on `head3-summary.json`:** HEAD3 was split by TBT (< 500 ms), not by `benchmarkIndex` (e.g. head3-hipoteca run-1 has benchmarkIndex 1422 but counts as fast). `--fast-by tbt` reproduces it byte for byte. To compare a new label with HEAD3, re-aggregate HEAD3 with the same rule: `node scripts/lighthouse-audit.mjs --aggregate-only --label head3 --out docs/plans/uh-results/head3-summary.bench.json`.
- Report the fast median, the slow median, and the all-runs median [min–max] separately.
- **Compare against a baseline only within the same CPU mode.** If a route has no fast run, say "n/a (no clean fast run)" rather than mixing modes.
- To get more fast runs: switch to the High-performance power plan, or pin Chrome to the P-cores.

## 5. Update the plan

Edit `docs/plans/plan.unlighthouse-improvements.md` (don't create a new plan file):

1. **Header**: date, audited commit (as verified in step 1), base URL, label, N.
2. **Scores Summary** table: add a column for the new label next to the previous baseline (e.g. `HEAD3 Perf (fast)` → `HEAD4 Perf (fast)`), plus the slow/all median [min–max]. Keep A11y / BP / SEO. Footnote anything non-comparable (local base, no fast run, different Lighthouse version).
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
- [ ] Run N = 5–10 sequential runs per route (`scripts/lighthouse-audit.mjs`)
- [ ] Every report validated (`finalDisplayedUrl`, `benchmarkIndex`); bad runs re-run
- [ ] `<label>-summary.json` written; fast and slow medians reported separately
- [ ] Plan tables updated (new column vs previous baseline), failing audits with `failCount`, fixes mapped

## Common issues

- **Unlighthouse flag trap**: unknown flags are ignored without warning, so a "per-route" scan really audits `/`. Earlier BASE/HEAD2 "per-route" numbers were all `#inicio` (head2-patrimonio audited `#ingresos`). Use the Lighthouse CLI.
- **Hash routes**: crawlers don't discover them. Pass the full URL with the hash to Lighthouse and validate `finalDisplayedUrl`. Always quote the URL in the shell.
- **Bimodal CPU**: see section 4. A sudden ±20-point Performance swing with an unchanged bundle is almost always the CPU mode; check `benchmarkIndex` before concluding anything.
- **Chrome / port leftovers**: an interrupted run can leave headless Chrome processes behind that eat CPU and hold debugging ports. On Windows, kill them before re-running:
  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object CommandLine -match 'headless' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
- **Windows paths**: use forward slashes in `--output-path`. The fallback uses bash `\` continuations, so in PowerShell put the lighthouse command on one line. Create the output dir first (`mkdir -p`), because Lighthouse may not create missing parent directories.
- **`--output-path` naming**: with multiple `--output` formats Lighthouse appends `.report.json` / `.report.html` to the given path. Pass `…/run-1`, not `…/run-1.json`.
- **Production sourcemaps**: `.map` files return 403 on Vercel, so `valid-source-maps` fails regardless of `build.sourcemap`. It's unscored, so ignore it.
