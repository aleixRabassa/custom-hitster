# Custom Hitster — Plan

A web app that turns a public Spotify playlist link into a playable digital Hitster deck.

---

## 1. Goal & Core Loop

**Input:** user pastes a public Spotify playlist URL → presses **Start**.

**Output:** a shuffled digital deck, played entirely in the browser.

```
Paste playlist URL
      ↓
  [ Start ]  → fetch tracks → resolve years → shuffle
      ↓
┌─────────────────────────┐
│  Card, "hidden" side    │  ← QR always shown, reveal nothing
│  QR  [▶ Play] [■ Stop]  │
│      [↺ Restart]        │
└─────────────────────────┘
   tap  → flip to reveal  → Title / Artist / Year
   swipe → next card
      ↓
  loop until deck empty OR [ End Game ]
```

**Non-negotiables from the brief**
- Hidden side must not leak title, artist, or year — that is the whole game.
- Tap = flip. Swipe = next card.
- Deck ends naturally (no cards left) or manually (End Game button).

---

## 2. Key Constraints (researched Aug 2026 — these shape everything)

Spotify's Feb 2026 Web API changes broke the obvious implementation:

| Constraint | Consequence |
|---|---|
| **Client Credentials can no longer read playlist `items`** — metadata only | A simple server-side API key proxy is dead |
| **User-authorized (PKCE) returns `items` only for playlists the logged-in user owns/collaborates on** | Would work for "make your own playlist"… |
| **…but new Development Mode apps are capped at 5 invited Spotify users** | …and therefore cannot serve "anyone with a link" |
| **Extended Quota Mode requires a registered org with 250k+ MAU** (since May 2025) | Not attainable for this project |
| `preview_url` removed from Web API responses for new apps (Nov 2024) | Official API can't give us audio either |
| Spotify-owned editorial/algorithmic playlists return 404 | Fine — users make their own playlists |

### Decisions taken

- **Audience: anyone with a public link.** → No Spotify login. → The official Web API cannot serve us. → We read the **public embed endpoint** (the approach the reference repo's "scraper mode" uses).
- **Playback: QR is always shown** on the hidden side (so a second device/phone can always scan-and-play in Spotify), **plus** in-app background playback when available — controlled by explicit **Play / Stop / Restart** buttons. Background audio is additive, not a replacement for the QR.
- **Release year comes from MusicBrainz, not Spotify.** Spotify returns the *album edition's* date, so remasters and compilations give wrong years (a 2011 remaster of Bohemian Rhapsody → 2011). MusicBrainz's earliest release date for a recording is exactly the value Hitster needs. This makes year resolution a **core component**, not an enrichment pass. **Fallback:** if MusicBrainz has no match (or is ambiguous/unavailable), use the year from the Spotify embed data instead of leaving the card blank — flagged in the review screen so the user knows it may be a re-release date.

> ⚠️ **Worth knowing:** scraping the embed endpoint and hiding/reskinning the embed player are outside Spotify's Developer Terms, and these unofficial endpoints can change without notice. Acceptable for a personal project; it does mean the QR fallback (step 3 below) must always remain functional so the app degrades instead of dying.

---

## 3. Architecture

```
Browser (SPA)                          Serverless (Vercel Functions)
┌──────────────────────┐               ┌─────────────────────────────────┐
│ Paste URL → Start    │──────────────▶│ /api/playlist                   │
│                      │               │  · parse playlist id            │
│                      │               │  · fetch open.spotify.com/embed │
│                      │◀──────────────│  · extract trackList JSON       │
│                      │  normalized   │  · return {id,title,artist,     │
│                      │  cards        │     previewUrl?}                │
│                      │               ├─────────────────────────────────┤
│ progressive fill     │──────────────▶│ /api/year  (batched)            │
│ (start on card 1)    │◀──────────────│  · MusicBrainz earliest release │
│                      │  years        │  · 1 req/s queue + cache        │
├──────────────────────┤               └─────────────────────────────────┘
│ shuffle (seeded)     │                              ↓
│ flip / swipe / audio │                     Cache (Upstash/Vercel KV)
│ localStorage resume  │
└──────────────────────┘
```

**Why a serverless backend at all** (the game itself is pure client-side):
1. CORS — the embed endpoint can't be fetched from the browser.
2. MusicBrainz requires a real `User-Agent` (unsettable in browser `fetch`) and 1 req/s.
3. A shared year cache across all users makes repeat playlists instant.

**Why progressive loading matters:** MusicBrainz at 1 req/s means a 100-track playlist takes ~100s worst case. So: resolve years in the background, start the game as soon as **card 1** is ready, and only block if the player outruns the resolver.

### Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| Build/Framework | **Vite + React 19 + TypeScript** | Client-heavy animated game; no SSR benefit. *(Alt: Next.js if you'd rather have one framework for UI + API routes.)* |
| Styling | **Tailwind CSS v4** | Fast iteration on a card-centric layout |
| Animation/Gestures | **Motion (framer-motion)** — `drag="x"`, `onDragEnd`, `AnimatePresence` | Swipe-to-next + stacked deck exit animations in very little code |
| Card flip | **Plain CSS 3D** — `preserve-3d`, `rotateY(180deg)`, `backface-visibility` | No library needed; GPU-composited |
| QR | **`qrcode`** (canvas/SVG) | Encode `https://open.spotify.com/track/{id}` — universal link opens the app |
| State | **`useReducer` + localStorage** | App is small; keeps deps low. *(Alt: Zustand + persist middleware)* |
| Backend | **Vercel Functions (Node runtime)** | Custom User-Agent, secrets, same deploy as frontend |
| Cache | **Upstash Redis / Vercel KV** | Year lookups + playlist snapshots; in-memory fallback for local dev |
| Tests | **Vitest** for pure logic; Playwright optional | URL parsing, shuffle, year resolution are the bug-prone parts |
| Deploy | **Vercel** | Static SPA + functions, free tier |

---

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Embed endpoint changes/breaks | Isolate all scraping in one adapter module with its own tests; QR is always shown regardless, so the game stays playable |
| Embed JSON truncates long playlists | **Spike this first** (Phase 0). If capped, add pagination or a manual track-paste fallback |
| No `audioPreview.url` / no in-app playback for some tracks | Play button is simply disabled/hidden for that card; QR is unaffected and always works |
| MusicBrainz has no match / is unavailable | **Fall back to the Spotify (embed) year** rather than blank; mark as "unconfirmed" in the review screen |
| MusicBrainz wrong or ambiguous match | Manual year-edit review screen before Start; always user-overridable |
| MusicBrainz slow (1 req/s) | Global cache + progressive loading + start game on card 1 |
| Tap vs swipe gesture conflict | Movement threshold in `onDragEnd`; `touch-action: none`; disable pull-to-refresh |
| Autoplay blocked by browsers | Playback always begins from an explicit user tap |

---

## 5. Step Plan

### Phase 0 — Spikes (decision gate; do this before writing app code)
- [ ] Spike: fetch `open.spotify.com/embed/playlist/{id}` server-side; extract the track list JSON. Record **max tracks returned** and available fields.
- [ ] Spike: confirm whether `audioPreview.url` is present per track, and measure coverage across a real 50-track playlist.
- [ ] Spike: Spotify **iFrame API** — can a visually hidden/covered embed be driven by `play()`/`pause()` with no metadata visible?
- [ ] Spike: MusicBrainz recording search — accuracy of earliest-release-date on 15 known-tricky tracks (remasters, compilations, live versions).
- [ ] **Decide the in-app playback mechanism** (hidden iFrame API vs. `previewUrl` + `<audio>`, whichever has better coverage/reliability) and record the decision here. **QR is shown regardless of this decision** — it's the permanent, always-available option; in-app Play/Stop/Restart is an addition on top when audio is available for that track.
- [ ] **Decide the track-source mechanism** and whether a manual-paste fallback is needed for v1.

### Phase 1 — Project Skeleton
- [ ] Init Vite + React + TS; add Tailwind, Motion, `qrcode`
- [ ] Repo hygiene: ESLint/Prettier, `.env.example`, README stub
- [ ] Vercel project linked; confirm a hello-world function deploys
- [ ] Vitest wired up with one trivial passing test

### Phase 2 — Data Layer
- [ ] `parsePlaylistUrl()` — handle `open.spotify.com/playlist/{id}`, `?si=` params, `spotify:playlist:` URIs, bare IDs (+ tests)
- [ ] `/api/playlist` — fetch, extract, normalize to `Card[]`; typed errors (private / not-found / unsupported)
- [ ] `/api/year` — MusicBrainz lookup, 1 req/s queue, batch endpoint
- [ ] Cache layer behind an interface (KV in prod, in-memory locally)
- [ ] Year-resolution logic + tests (fuzzy title match, feat./remaster/live stripping, pick earliest, **fall back to Spotify year when MusicBrainz has no confident match**)

### Phase 3 — Deck & Game State
- [ ] `Card` and `GameState` types; reducer with `START`, `FLIP`, `NEXT`, `END`
- [ ] Seeded Fisher–Yates shuffle (reproducible decks) + tests
- [ ] localStorage persist/resume mid-game
- [ ] Progressive loading: playable at card 1, background-fill the rest, block gracefully if the player outruns the resolver

### Phase 4 — Card UI
- [ ] Card component with CSS 3D flip; hidden side must leak **nothing**
- [ ] Hidden side: **QR code always rendered**, plus **Play / Stop / Restart** buttons for in-app audio (Restart = replay from 0:00, not next card)
- [ ] Reveal side: title, artist, **year prominent** (Hitster's key value)
- [ ] In-app audio wired to the Phase 0 winner; if unavailable for a track, disable Play/Stop/Restart but keep the QR fully functional
- [ ] Stop audio on flip/next/end/restart — never let a track bleed into the next card or double up on itself

### Phase 5 — Gestures
- [ ] Swipe-to-next with velocity/offset threshold + snap-back below threshold
- [ ] Tap-to-flip, reliably distinguished from drag
- [ ] Stacked-deck visual (2–3 cards peeking) and exit animation
- [ ] Keyboard controls (Space = flip, → = next) for laptop/tablet play
- [ ] Verified on real iOS Safari + Android Chrome (touch is where this breaks)

### Phase 6 — Game Flow Screens
- [ ] Landing: URL input, validation, inline error states
- [ ] Loading state showing year-resolution progress
- [ ] **Year review/edit screen** before Start (fix MusicBrainz mistakes)
- [ ] In-game HUD: cards remaining, End Game button
- [ ] End screen: cards played, restart / new playlist

### Phase 7 — Polish
- [ ] Card visual design (take cues from the reference repo's neon-ring aesthetic)
- [ ] Empty/error/offline states; friendly message for private playlists
- [ ] Responsive: phone, tablet, desktop
- [ ] Basic a11y: focus states, ARIA on controls, respect `prefers-reduced-motion`
- [ ] Lighthouse pass; lazy-load QR/audio code
- [ ] README: setup, env vars, deploy, known limitations

### Phase 8 — Nice-to-haves (explicitly out of v1)
- [ ] Shareable deck URL (playlist id + shuffle seed = whole deck)
- [ ] PWA / offline via `vite-plugin-pwa`
- [ ] Multiple decks / saved playlists
- [ ] Printable PDF export (the reference repo's actual purpose)
- [ ] Difficulty filters (e.g. decade ranges)
- [ ] Multi-player scoring / timeline placement

---

## 6. Open Questions
- [ ] Card art direction — reuse the reference repo's neon-ring look, or something new?
- [ ] Is a manual "paste track links" fallback wanted in v1 if the embed scrape proves unreliable?
- [ ] Should year review be mandatory before Start, or skippable with a "years may be off" warning?

---

## 7. Reference
- Reference implementation: <https://github.com/WhiteShunpo/hitster-card-generator> — Python/Streamlit, outputs print-ready A4 PDFs. **Not code-reusable** for this SPA, but valuable for: the no-API scraper approach, the original-release-year problem framing, and card layout/aesthetics.
- Spotify Feb 2026 migration guide: <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>
- Spotify July 2026 quota updates: <https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates>
- MusicBrainz API: <https://musicbrainz.org/doc/MusicBrainz_API> (1 req/s, `User-Agent` required)
