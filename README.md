# Custom Hitster

Turn any public Spotify playlist link into a playable digital [Hitster](https://hitstergame.com/) deck. Paste a playlist URL, press Start, and get a shuffled deck of cards you play in the browser: each card shows only a QR code, and you tap to reveal the title, artist, and — the part the game is actually about — the song's **original** release year. Release years come from MusicBrainz rather than Spotify, because Spotify reports the _album edition's_ date, which turns a 2011 remaster of Bohemian Rhapsody into a 2011 song.

Built with **Vite 8 + React 19 + TypeScript + Tailwind CSS v4**, with a thin **Vercel Functions** backend that exists only to do what a browser can't: reach a CORS-blocked endpoint, set a custom `User-Agent`, and hold a cache shared across users.

> **Status: Phase 1 (project skeleton).** The toolchain, serverless function directory, and test harness are in place and verified. **There is no game yet** — `src/App.tsx` is a placeholder. See [`docs/plans/plan.md`](./docs/plans/plan.md) for the phase plan.

---

## Documentation

| File                                             | What it covers                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [`docs/architecture.md`](./docs/architecture.md) | Components, import boundaries between `src`/`api`/`shared`, data flow, external services, planned phases  |
| [`docs/api.md`](./docs/api.md)                   | The `api/` surface, handler conventions, environment variable reference                                   |
| [`docs/toolchain.md`](./docs/toolchain.md)       | The two TypeScript installs, the four tsconfigs, ESLint/Prettier, pnpm and the Node pin, Tailwind, Vitest |
| [`docs/development.md`](./docs/development.md)   | Setup, scripts, running functions locally, tests, deploy, known limitations                               |
| [`docs/plans/plan.md`](./docs/plans/plan.md)     | Authoritative phase plan, plus all Phase 0 research findings                                              |
| [`AGENTS.md`](./AGENTS.md)                       | Conventions and key rules for contributors and coding agents                                              |

---

## Quickstart

Requires **Node 24.x** and **pnpm 10.29.2** (pnpm is the only supported package manager).

```bash
pnpm install
cp .env.example .env.local   # optional — nothing reads it until Phase 2
pnpm dev                     # http://localhost:5173
```

To exercise the serverless functions you need Vercel's own dev server, because **`pnpm dev` does not serve `api/`** — and it fails in a misleading way if you try (a `200` with transpiled source; see [`docs/architecture.md`](./docs/architecture.md) §5):

```bash
vercel dev
curl http://localhost:3000/api/hello
# {"ok":true,"message":"custom-hitster api is alive","maxEmbedTracks":100}
```

That `maxEmbedTracks: 100` is the meaningful part — it proves a function can import from `shared/` and have it resolve in a real bundle.

Before committing, all four of these must pass:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Development tip

`pnpm dev` gives Vite HMR, so card animations and Tailwind classes update on save without a reload. Pair it with `pnpm test:watch` in a second terminal for the pure-logic suites. Note that `pnpm build` deliberately **does not** typecheck — run `pnpm typecheck`, which gates `src/` and `api/` separately.

If something in `package.json` or the tsconfigs looks wrong — two TypeScript versions, a root tsconfig that refuses to use project references, an `engines.node` that doesn't match your machine — it is intentional. [`docs/toolchain.md`](./docs/toolchain.md) explains each one.
