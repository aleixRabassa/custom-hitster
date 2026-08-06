# Custom Hitster

Turn any public Spotify playlist link into a playable digital [Hitster](https://hitstergame.com/) deck. Paste a playlist URL, press Start, and get a shuffled deck of cards you play in the browser: each card shows only a QR code, and you tap to reveal the title, artist, and — the part the game is actually about — the song's **original** release year. Release years come from MusicBrainz rather than Spotify, because Spotify reports the _album edition's_ date, which turns a 2011 remaster of Bohemian Rhapsody into a 2011 song.

Built with **Vite 8 + React 19 + TypeScript + Tailwind CSS v4**, with a thin **Vercel Functions** backend that exists only to do what a browser can't: reach a CORS-blocked endpoint, set a custom `User-Agent`, and hold a cache shared across users.

> **Status: playable end to end. Phases 0–7 complete, and three of Phase 8's five items built** — 579 tests across 40 files. Paste a link or pick one of nine suggested playlists, and you get a shuffled deck you can flip, swipe, scan and play audio from, with a HUD, an exit confirmation and an end screen. The deck resumes across a reload. Phase 8 added **a shareable deck link, a saved-playlist library and a printable PDF export** (2026-08-06); the **card visual redesign and the PWA are still open** — see [`docs/plans/plan.md`](./docs/plans/plan.md).
>
> **You must run it under `vercel dev`, not `pnpm dev`** — see [Quickstart](#quickstart). Under `pnpm dev` the app loads but Start always fails, and it fails in a way that looks like an app bug.

---

## Documentation

| File                                                 | What it covers                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`docs/architecture.md`](./docs/architecture.md)     | Components, import boundaries between `src`/`api`/`shared`, data flow, external services, planned phases  |
| [`docs/api.md`](./docs/api.md)                       | The `api/` surface, handler conventions, environment variable reference                                   |
| [`docs/toolchain.md`](./docs/toolchain.md)           | The two TypeScript installs, the four tsconfigs, ESLint/Prettier, pnpm and the Node pin, Tailwind, Vitest |
| [`docs/development.md`](./docs/development.md)       | Setup, scripts, running functions locally, tests, deploy, known limitations                               |
| [`docs/agent_findings.md`](./docs/agent_findings.md) | Running log of discoveries and gotchas found while working in this repo                                   |
| [`docs/plans/plan.md`](./docs/plans/plan.md)         | Authoritative phase plan, plus all Phase 0 research findings                                              |
| [`docs/plans/`](./docs/plans/)                       | Per-phase plans: Phase 1, Phase 2 (×2), Phase 3, Phases 4–6 (×3), Phase 7 (×2), Phase 8 (×3)              |
| [`AGENTS.md`](./AGENTS.md)                           | Conventions and key rules for contributors and coding agents                                              |

---

## Quickstart

Requires **Node 24.x** and **pnpm 10.29.2** (pnpm is the only supported package manager).

```bash
pnpm install
cp .env.example .env.local   # then set MUSICBRAINZ_USER_AGENT — see Environment variables
npx vercel dev               # http://localhost:3000
```

**`npx vercel dev` is the command that runs the app**, and `pnpm dev` is not an alternative to it. Vite's dev server does not execute functions — it serves `api/playlist.ts` as **transpiled source with status 200**, so pressing Start shows _"Spotify returned something we could not read. This is a problem on our side, not with your link."_ That is the client behaving exactly as designed against a response that is not a playlist, but it reads like a bug in the app. See [`docs/development.md`](./docs/development.md) §4.

`pnpm dev` is still the right tool for what it is actually for — **component work with HMR**, where Tailwind classes and card animations update on save:

```bash
pnpm dev                     # http://localhost:5173 — UI only, Start will fail
pnpm test:watch              # pair it with this in a second terminal
```

Before committing, all four of these must pass. There are no pre-commit hooks and no CI:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

`pnpm build` deliberately **does not** typecheck — `pnpm typecheck` gates `src/` and `api/` separately.

---

## What you can do with a deck once you have played it

The end screen offers three things beyond "play again", and each has one caveat worth knowing.

**Share it.** _Copy share link_ produces a URL carrying the playlist and the shuffle seed. Opening it deals the same playlist in the same order without touching the form — and if you have a game in progress, **the link is ignored and your game survives**; reload after finishing to use it. What the link **cannot** promise is an identical set of cards: a card whose release year cannot be found is dropped at play time, and Spotify refreshes its own editorial playlists, so the shuffle is exact while its input is not. The app says "same playlist, same shuffle" for that reason.

**Save it.** _Save this playlist_ adds it to **Your playlists** on the start screen, above the suggestions, where one click deals it again. Saving is deliberately explicit — the start screen is not a log of every URL anyone pasted. Only the playlist's id, name and the date are stored, in your own browser; up to twenty, most recent first, each removable.

**Print it.** _Print as PDF cards_ builds a real physical deck: **65 mm square cards, 12 to an A4 sheet**, QR codes on the fronts and years on the backs, sized to match shop-bought Hitster cards.

> **Print double-sided on the LONG edge.** The back sheet's columns are mirrored to compensate for exactly that, and a printer set to short-edge binding will pair every card with the wrong answer. The app cannot read your printer's settings, so this is the one instruction it cannot enforce.

Cards whose year has not arrived yet are left out and counted, never listed. Titles print in a Latin-1 font, so Cyrillic, Greek and CJK titles come out as `?` — the year and the QR code are unaffected, so the card still plays and still scans.

---

## Environment variables

Full reference, including exactly how the app behaves when each is missing, in [`docs/api.md`](./docs/api.md) §"Environment variables".

| Variable                   | Needed             | Notes                                                                                                                                                                                                                                               |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MUSICBRAINZ_USER_AGENT`   | Local + production | **You write it**, format `AppName/Version ( contact )`. MusicBrainz blocks anonymous traffic, so without it every `/api/year` call returns `500 not-configured` and no card ever gets a year. The app stays playable and raises a notice saying so. |
| `UPSTASH_REDIS_REST_URL`   | Production only    | The shared year cache. Provision Upstash Redis through the Vercel Marketplace and both variables are injected.                                                                                                                                      |
| `UPSTASH_REDIS_REST_TOKEN` | Production only    | Same place, shown alongside the URL.                                                                                                                                                                                                                |

The two Upstash variables are **a pair a deployment either has both of or neither**. With neither, the cache degrades to an in-memory one per function instance — which is a real degradation rather than a no-op: the cache is what makes a repeated playlist instant, and the 1 req/s MusicBrainz gate is backed by the same store, so without them the gate paces nothing across instances. A half-configured deployment (URL only) is logged as a warning, because it is almost certainly a mistake.

**There are no Spotify credentials, and none are needed.** That is a product decision, not an oversight — Spotify's Feb 2026 API changes mean no credentialed path can serve "anyone with a public link", so the app reads the public embed endpoint anonymously. [`docs/plans/plan.md`](./docs/plans/plan.md) §2 has the reasoning; read it before adding a `SPOTIFY_CLIENT_ID`.

---

## Deploy

```bash
npx vercel        # preview
npx vercel --prod # production
```

Then check the one thing **no local tool can verify**:

```bash
curl https://<your-deployment>/api/hello
# {"ok":true,"message":"custom-hitster api is alive","maxEmbedTracks":100}
```

`maxEmbedTracks: 100` is the meaningful part. It proves a deployed function can import from `shared/` and have the specifier resolve in Vercel's real bundle — and that is checkable **only** on a deployment. An extensionless relative import (`'../shared/constants'` instead of `'../shared/constants.js'`) type-checks locally, builds with no error, passes all four local checks, and then fails at runtime with `FUNCTION_INVOCATION_FAILED`. Same for an `@/` alias under `api/`, which Vercel does not support. Both were learned from real deploys; see [`AGENTS.md`](./AGENTS.md) and [`docs/agent_findings.md`](./docs/agent_findings.md).

Deploy details, including what the preview-deployment verification still owes, in [`docs/development.md`](./docs/development.md) §7.

---

## Known limitations

Summarised; the full list with measurements is [`docs/development.md`](./docs/development.md) §8. A README that omits these oversells the app.

- **Playlists are capped at 100 tracks, and the app cannot tell when it happened.** The embed payload carries no pagination signal at all — no total, no offset, no `hasMore` — so exactly 100 tracks is indistinguishable from a playlist that genuinely holds 100. A non-blocking notice appears at exactly 100.
- **Release years are sometimes wrong.** MusicBrainz has no canonical "original studio recording" per song. The strict pass placed 14 of 14 known-tricky tracks exactly, but that is a curated set; a track it cannot place falls through to a relaxed pass that is measurably off by a year or so, and those are marked unconfirmed on the card. A card whose lookup finds nothing at all is removed from the deck, so a real playlist deals roughly a third fewer cards than it has tracks.
- **The first play of a cold playlist is slow, and the 1 req/s MusicBrainz budget is global.** Two paced requests per track means a cold 100-track playlist takes several minutes. The cache means only genuinely new songs pay it, but two people resolving cold playlists at once each get half the throughput.
- **In-app audio covers ~99.5% of tracks**, measured across 398/400. Without a preview URL the audio controls are disabled; the QR code always renders, so the card still works.
- **The embed endpoint is unofficial** and may change or break without notice. Reading it is outside Spotify's Developer Terms — an accepted risk for a personal project. All scraping is confined to one adapter module, and the QR renders regardless, so the deck degrades rather than dies.
- **A mid-game disconnect is survivable and unsignalled.** The QR is a data URL, and the flip and swipe are local, so the deck stays playable; only audio previews and further year lookups stop, and the resolver already retries those. There is deliberately no offline banner.
- **Touch gestures were tested on one Android phone and on no iPhone** (2026-08-06). They worked and nothing was retuned, so the five thresholds in `src/game/gestures.ts` are validated by one thumb rather than unvalidated — but iOS Safari, which handles gestures more strictly, has still never seen them. If touch input misbehaves there, those constants are the first place to look.
- **A shared deck link reproduces the shuffle, not the deck.** The link is a playlist id plus a seed, and the shuffle it produces is exact — but cards whose year cannot be found are dropped at play time, and Spotify refreshes editorial playlists, so two people opening the same link get the same playlist in the same order and may not get identical cards. The app says "same playlist, same shuffle" rather than promising more.
- **The printable PDF has never been printed.** The sheet geometry, the pagination and the duplex column mirror are unit-tested, and the mirror is the part that matters — but no one has yet run a sheet through a printer, cut it, or scanned a printed code. **Print double-sided on the long edge**; short-edge binding is not supported and the app cannot detect it.
- **The PDF prints non-Latin titles as `?`.** A standard PDF font covers Latin-1, which includes every Spanish, Portuguese, French, German and Italian character; Cyrillic, Greek and CJK have no equivalent and are replaced. The year and the QR code are unaffected, so the card still plays and still scans. Embedding a font that covered more would have cost several hundred kilobytes to fix a fraction of the gap.
- **Saved playlists and the resumable game share one browser's storage, and two tabs will clobber each other.** Last write wins. A saved playlist is only an id, a name and a date, so the cost is a row you re-save.
- **A playlist whose tracks MusicBrainz cannot place deals no game at all.** Cards without a year are removed from the deck, so an obscure or very new playlist can empty it entirely; the app warns and returns you to the start screen rather than pretending you finished a deck.
- **Progressive loading has never been verified against a real deployment** with Upstash configured, and neither has the game screen's Lighthouse score. The landing screen scores **Performance 99 · Accessibility 100 · Best Practices 100 · SEO 100** (2026-08-06, production build, LCP 1.6 s); Accessibility 100 is an automated floor, not a result.
- **None of Phase 7's reduced-motion, responsive, keyboard or screen-reader behaviour has been verified**, and no test in this repo can verify it — jsdom has no media queries, no `matchMedia`, no layout and no accessibility tree, so both ends of each contract are asserted and nothing in between. The screen-reader pass is the one to prioritise.

---

## A note on the toolchain

If something in `package.json` or the tsconfigs looks wrong — two TypeScript versions, a root tsconfig that refuses to use project references, an `engines.node` that doesn't match your machine — **it is intentional**. [`docs/toolchain.md`](./docs/toolchain.md) explains each one, and [`AGENTS.md`](./AGENTS.md) lists the ones that fail only at deploy time.
