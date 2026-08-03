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
┌─────────────────────────────────────┐
│      Card, "hidden" side            │  ← QR always shown, reveal nothing
│               QR                    │
│ [■ Exit] [▶ Play/Pause] [↺ Restart] │
└─────────────────────────────────────┘
   tap  → flip to reveal  → Title / Artist / Year
   swipe → next card
      ↓
  loop until deck empty OR [ Exit ]
```

**Visual mockup:**

![Custom Hitster mockup — landing page, hidden QR card, reveal, and end screen](./custom-hitster-mockup.png)

Left-to-right/top-to-bottom: desktop landing page (URL input + suggested playlists from Phase 6), desktop card view showing the hidden QR side, then the mobile flow — landing, hidden side (QR + Exit/Play-Pause/Restart), revealed side (title/artist/year), the CSS 3D flip mid-transition, a second revealed card, and the end-of-deck screen.

**Non-negotiables from the brief**

- Hidden side must not leak title, artist, or year — that is the whole game.
- Tap = flip. Swipe = next card.
- Deck ends naturally (no cards left) or manually (Exit button on the card, which ends the session and redirects to the landing page).

---

## 2. Key Constraints (researched Aug 2026 — these shape everything)

Spotify's Feb 2026 Web API changes broke the obvious implementation:

| Constraint                                                                                            | Consequence                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Client Credentials can no longer read playlist `items`** — metadata only                            | A simple server-side API key proxy is dead       |
| **User-authorized (PKCE) returns `items` only for playlists the logged-in user owns/collaborates on** | Would work for "make your own playlist"…         |
| **…but new Development Mode apps are capped at 5 invited Spotify users**                              | …and therefore cannot serve "anyone with a link" |
| **Extended Quota Mode requires a registered org with 250k+ MAU** (since May 2025)                     | Not attainable for this project                  |
| `preview_url` removed from Web API responses for new apps (Nov 2024)                                  | Official API can't give us audio either          |
| Spotify-owned editorial/algorithmic playlists return 404                                              | Fine — users make their own playlists            |

### Decisions taken

- **Audience: anyone with a public link.** → No Spotify login. → The official Web API cannot serve us. → We read the **public embed endpoint** (the approach the reference repo's "scraper mode" uses).
- **Playback: QR is always shown** on the hidden side (so a second device/phone can always scan-and-play in Spotify), **plus** in-app background playback when available — controlled by explicit **[■ Exit] / [▶ Play/Pause] / [↺ Restart]** buttons (Exit ends the game session and returns to the landing page). Background audio is additive, not a replacement for the QR.
- **Release year comes from MusicBrainz, not Spotify.** Spotify returns the _album edition's_ date, so remasters and compilations give wrong years (a 2011 remaster of Bohemian Rhapsody → 2011). MusicBrainz's earliest release date for a recording is exactly the value Hitster needs. This makes year resolution a **core component**, not an enrichment pass. **Fallback:** if MusicBrainz has no match (or is ambiguous/unavailable), use the year from the Spotify embed data instead of leaving the card blank — flagged in the review screen so the user knows it may be a re-release date.

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

| Layer              | Choice                                                                     | Why                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Build/Framework    | **Vite + React 19 + TypeScript**                                           | Client-heavy animated game; no SSR benefit. _(Alt: Next.js if you'd rather have one framework for UI + API routes.)_ |
| Styling            | **Tailwind CSS v4**                                                        | Fast iteration on a card-centric layout                                                                              |
| Animation/Gestures | **Motion (framer-motion)** — `drag="x"`, `onDragEnd`, `AnimatePresence`    | Swipe-to-next + stacked deck exit animations in very little code                                                     |
| Card flip          | **Plain CSS 3D** — `preserve-3d`, `rotateY(180deg)`, `backface-visibility` | No library needed; GPU-composited                                                                                    |
| QR                 | **`qrcode`** (canvas/SVG)                                                  | Encode `https://open.spotify.com/track/{id}` — universal link opens the app                                          |
| State              | **`useReducer` + localStorage**                                            | App is small; keeps deps low. _(Alt: Zustand + persist middleware)_                                                  |
| Backend            | **Vercel Functions (Node runtime)**                                        | Custom User-Agent, secrets, same deploy as frontend                                                                  |
| Cache              | **Upstash Redis / Vercel KV**                                              | Year lookups + playlist snapshots; in-memory fallback for local dev                                                  |
| Tests              | **Vitest** for pure logic; Playwright optional                             | URL parsing, shuffle, year resolution are the bug-prone parts                                                        |
| Deploy             | **Vercel**                                                                 | Static SPA + functions, free tier                                                                                    |

---

## 4. Risks & Mitigations

| Risk                                                       | Mitigation                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Embed endpoint changes/breaks                              | Isolate all scraping in one adapter module with its own tests; QR is always shown regardless, so the game stays playable |
| Embed JSON truncates long playlists                        | **Spike this first** (Phase 0). If capped, add pagination or a manual track-paste fallback                               |
| No `audioPreview.url` / no in-app playback for some tracks | Play/Pause button is simply disabled/hidden for that card; QR and Exit are unaffected and always work                    |
| MusicBrainz has no match / is unavailable                  | **Fall back to the Spotify (embed) year** rather than blank; mark as "unconfirmed" in the review screen                  |
| MusicBrainz wrong or ambiguous match                       | Manual year-edit review screen before Start; always user-overridable                                                     |
| MusicBrainz slow (1 req/s)                                 | Global cache + progressive loading + start game on card 1                                                                |
| Tap vs swipe gesture conflict                              | Movement threshold in `onDragEnd`; `touch-action: none`; disable pull-to-refresh                                         |
| Autoplay blocked by browsers                               | Playback always begins from an explicit user tap                                                                         |

---

## 5. Step Plan

### Phase 0 — Spikes (decision gate; do this before writing app code)

- [x] Spike: fetch `open.spotify.com/embed/playlist/{id}` server-side; extract the track list JSON. Record **max tracks returned** and available fields.
  - **Where the data lives:** GET the embed page with a normal browser `User-Agent`; response is HTTP 200 HTML containing `<script id="__NEXT_DATA__" type="application/json">`. Parse that JSON; tracks are at `props.pageProps.state.data.entity.trackList`.
  - **Max tracks returned: capped at 100 — confirmed by truncation, not just assumed.** "Rock Classics" (`37i9dQZF1DWXRqgorJj26U`), independently reported to hold 200 saved tracks, returned exactly 100 `trackList` entries. "Today's Top Hits" returned 50, matching its actual size (not a truncation case). **No pagination signal exists anywhere in the payload** — no total count, offset, or `hasMore` field — so the response is indistinguishable between "this playlist has ≤100 tracks" and "this playlist was silently truncated." This confirms the risk flagged in §4: **v1 needs either a documented 100-track limit or a manual-paste fallback for longer playlists** — the embed endpoint itself offers no way to page past track 100.
  - **Playlist-level fields:** `name`/`title`, `uri`, `id`, `subtitle` (owner, e.g. "Spotify"), `coverArt.sources[]`, `releaseDate` (null), `duration`, `isPlayable`, `isExplicit`, `trackList[]`, `visualIdentity` (theme colors), `attributes[]` (key/value pairs, e.g. `isAlgotorial`, `status`), `format`.
  - **Track-level fields (union across 150 sampled tracks):** `uri`, `uid`, `title`, `subtitle` (artist name(s) as **one joined string**, not a structured array — needs splitting), `isExplicit`, `isNineteenPlus`, `contentRatings.labels[]`, `duration` (ms), `isPlayable`, `playabilityReason`, `audioPreview.{format,url}`, `entityType`. **No album name and no release date/year at track level** — validates the plan's decision that year must come from MusicBrainz, not this endpoint.
  - **`audioPreview.url` coverage:** 100/100 tracks had it on the "Rock Classics" sample — promising, but this was one playlist; the dedicated Phase 0 preview-coverage spike below should confirm on a broader/newer sample.
  - **Error shape is not HTTP-status-based:** a nonexistent playlist ID still returns HTTP 200; the JSON's `pageProps` has `{status: 404, title: "Page not found", ...}` instead of `{state: {...}}`. The adapter must branch on `pageProps.state` presence, not on the HTTP response code. (Private playlists not tested — no ID on hand — but likely shaped the same way, to avoid leaking existence.)
  - **Dead end worth recording:** the embed JSON also leaks a short-lived anonymous Spotify Web API bearer token at `state.settings.session.accessToken`. Tried it against `api.spotify.com/v1/playlists/{id}/tracks?offset=100` to fetch tracks 101–200 directly — immediate `429 QUOTA_EXCEEDED`. The embed's client ID is shared globally by every visitor loading any embed on the internet, so its quota is already exhausted; **not usable** as a pagination workaround.
- [x] Spike: confirm whether `audioPreview.url` is present per track, and measure coverage across a real 50-track playlist.
  - **Coverage: 398/400 tracks (99.5%)** across 5 genre/era-diverse playlists, each independently fetched and identity-verified via `entity.uri` (to rule out a stale/wrong playlist): Today's Top Hits (current pop, 50/50), Rock Classics (60s–2020s rock, 100/100), RapCaviar (hip-hop, 50/50), Reggae Classics (98/100), All Out 80s (100/100).
  - **The only gaps were both older reggae catalog tracks** — "Uptown Top Ranking – Remastered 2001" (Althea and Donna) and "Stir It Up" (Bob Marley & The Wailers) — consistent with the plan's general expectation that older/remastered catalog is where preview coverage is most likely to thin out. Sample is small (n=2 missing), so treat as a directional signal, not a hard rule.
  - **Conclusion: coverage is high enough that `previewUrl` + `<audio>` is a solid primary path**, with the Play/Pause and Restart buttons simply disabled on the rare track that lacks one (Exit and QR remain unaffected) (per the existing risk mitigation in §4) — no need to lean on the iFrame API purely for coverage reasons. The iFrame API spike below still matters for the "hidden/no-metadata-leak" requirement specifically.
  - **Methodology note:** an earlier attempt fanned this out across 5 parallel subagents that all wrote to the same generic filename (`embed.html`) in the shared scratchpad, causing a write-race — two agents silently read a different playlist's data (one caught it via `entity.name`, one didn't). Re-ran sequentially with per-playlist filenames and an `entity.uri` identity check per fetch; numbers above are from that clean run.
- [x] Spike: Spotify **iFrame API** — can a visually hidden/covered embed be driven by `play()`/`pause()` with no metadata visible?
  - **Ruled out on Terms-of-Service grounds, independent of technical feasibility.** Spotify's official embed terms (`developer.spotify.com/documentation/embeds/terms`) state: _"You shall not obfuscate the Spotify Widgets in any way, whether by banner advertisements or by any other means, or alter the form or format of the Spotify Widgets from that made available by Spotify"_ and _"You shall display the Spotify Widgets in the form made available by Spotify, without alteration..."_ A hidden or covered iframe is exactly what these clauses prohibit — so even if `play()`/`pause()` could be driven on a hidden embed, doing so would violate the terms this project already accepts some risk under (§2's ⚠️ note), and there's no upside to add that specific extra violation on top when the alternative below already works.
  - **No technical upside to chase anyway:** the previous spike already found `previewUrl` + `<audio>` covers 99.5% of tracks. The iFrame route's only remaining selling point would've been full-track playback or better reliability — not worth pursuing given the ToS blocker.
  - **Process note:** the planned 5-way fan-out (docs, JS bundle inspection, media-session leak risk, autoplay/gesture policy, live test harness) failed 5/5 mid-run — the org hit its Claude monthly spend limit. One agent's partial output before it died had already surfaced the ToS quote above; a direct follow-up `WebFetch` (main thread, not a subagent) confirmed it and was enough to close this spike. The other four angles (JS event payload shape, OS media-session behavior, autoplay-gesture nuances for cross-origin iframes) were not completed and don't need to be — they were only relevant to evaluating an approach now ruled out.
- [x] Spike: MusicBrainz recording search — accuracy of earliest-release-date on 15 known-tricky tracks (remasters, compilations, live versions).
  - **Naive top-scored-recording lookup is unreliable: only 1 of 18 tested lookups (~6%) returned the correct year on the first try.** Tested 15 tricky tracks (3 remasters, 3 compilation/reissue classics, 3 famous-live-version tracks, 2 more live/bootleg-heavy rock classics, 1 clean control track, and 3 cover-vs-original pairs each queried twice = 18 total artist+title lookups) against `GET /ws/2/recording/?query=recording:"TITLE" AND artist:"ARTIST"`, taking the top-scored result's earliest linked release date. Only "Smells Like Teen Spirit" (Nirvana) came back correct on the first pass (1991); "Layla" (Derek and the Dominos) was off-by-one (1971 single vs. 1970 album); all other 16 lookups returned a wrong year — usually a live bootleg, remix, or reissue recording with a completely unrelated date (examples: "Stairway to Heaven" → 2025 bootleg box set; "Like a Rolling Stone" → 2002 Dylan bootleg out of 706 same-scored candidates; "Free Bird" → 1998 live album instead of 1973 studio).
  - **Root cause: MusicBrainz has no single canonical recording per song — every bootleg, live take, remix, and reissue of a famous track is its own recording entity, and dozens tie at the maximum relevance score.** For classic-rock catalog especially (Dylan: 706 matching recordings, "Free Bird": 166, "Stairway to Heaven": 842), the search API ranks by text match only, with no notion of "the original studio recording."
  - **Remaster-suffixed titles, as Spotify would actually present them (e.g. "Bohemian Rhapsody - Remastered 2011"), returned zero MusicBrainz results in every case tested.** The literal suffix breaks the query; titles must be stripped of "- Remastered YYYY" / "- Remaster" / "- Live" / "(feat. X)"-style suffixes before querying — mandatory, not an optimization.
  - **A fix was verified correct in all 12 cases it was tried on: bias the candidate pool toward `release-group` entries with `primary-type: Album` and no `secondary-types` of Live/Compilation/Remix/Bootleg (and release `status: Official`), instead of trusting the recording search's relevance score.** This resolved all 3 compilation-era tracks (Billie Jean, Sweet Child O' Mine, Hotel California), all 3 live-version tracks (Wish You Were Here, No Woman No Cry, Layla), and all 6 cover-vs-original lookups (Hallelujah/Cohen+Buckley, I Will Always Love You/Parton+Houston, All Along the Watchtower/Dylan+Hendrix) to their exact known-correct year. Not independently re-verified for the remaster batch or the two still-wrong rock tracks (Free Bird, Like a Rolling Stone), but the same release-group signals were present there too and the fix is expected to generalize.
  - **Constraint this puts on the real implementation: the fix above must not depend on knowing the album name.** Two of the five spike batches happened to query MusicBrainz release-groups _by the known correct album title_ — a shortcut only available in a spike with ground truth on hand. **The Spotify embed endpoint has no album name at track level** (confirmed in the first Phase 0 spike above), so Phase 2's year-resolution logic has to filter on release-group `secondary-types` / release `status` alone — both MusicBrainz-side signals that don't require an album name as input.
  - **Secondary heuristic: track duration (available from the Spotify embed's track-level `duration` field) reliably separates studio cuts from live/extended versions** when disambiguation text is absent or unhelpful (e.g. distinguishing a ~3:42 studio "No Woman No Cry" from its ~6:35 live counterpart) — usable as a tie-breaker inside the filtered candidate set.
  - **Artist-name filtering is reliable: 0 of 6 cover-vs-original lookups cross-contaminated artists** (a "Leonard Cohen" query never returned Jeff Buckley's recording or vice versa) — safe to always include the split artist name (per the subtitle-splitting need already noted in the first Phase 0 spike) in the MusicBrainz query.
  - **Missing/empty `date` fields are common on bootleg and compilation releases** (seen in the remaster and compilation batches) — earliest-date calculation needs a null/empty guard, not a bare `min()` over all dates present.
  - **Methodology:** 5 subagents fanned out in parallel, 3 tracks each, staggered start offsets (0/4/8/12/16s) plus ≥1.2s between each agent's own MusicBrainz calls, each using `curl` with a descriptive `User-Agent` header — to stay within MusicBrainz's 1 req/s policy despite 5 concurrent callers. No rate-limit errors were reported by any batch.
- [x] **Decide the in-app playback mechanism**: **`previewUrl` + `<audio>`**, not the iFrame API. Coverage is 99.5% (measured); the iFrame API is disqualified by Spotify's own embed terms for anything hidden/covered/altered (measured above), so there's no live alternative to weigh it against anyway. Implementation notes for Phase 4: don't set `navigator.mediaSession.metadata` on the `<audio>` element (avoids leaking title/artist to OS lock-screen/notification "now playing" UI — a leak vector that exists independent of on-page hiding); call `.play()` synchronously inside the button's click handler (standard user-gesture requirement, already the plan's approach). **QR is shown regardless of this decision** — it's the permanent, always-available option; in-app Play/Pause/Restart is an addition on top, disabled for the ~0.5% of tracks without a `previewUrl` (Exit and QR remain unaffected).
- [x] **Decide the track-source mechanism** and whether a manual-paste fallback is needed for v1: **the embed endpoint remains the sole v1 track source; no manual-paste fallback for v1.** Given the confirmed 100-track cap with no pagination signal (first Phase 0 spike above) and no reliable way to distinguish "playlist has ≤100 tracks" from "playlist was silently truncated," building and testing a manual-paste UX now would be speculative effort against a failure mode that's likely rare (most personal/shared playlists are well under 100 tracks). Instead: **when `trackList.length === 100` exactly, surface a non-blocking warning** ("this playlist may have more tracks than shown — only the first 100 could be loaded") rather than silently presenting a possibly-incomplete deck as complete. A real manual-paste or pagination fallback is deferred to a fast-follow / Phase 8 nice-to-have if the 100-track cap turns out to bite real users.

### Phase 1 — Project Skeleton (complete)

- [x] Init Vite + React + TS; add Tailwind, Motion, `qrcode`
- [x] Repo hygiene: ESLint/Prettier, `.env.example`, README stub
- [x] **Vercel project linked; confirm a hello-world function deploys** — linked and deployed manually by the developer (decision 4 of the phase plan), reported successful 2026-08-03. This closes the one part of Phase 1 that could not be verified locally: the deploy exercises the root `tsconfig.json` against `api/`, which is the payoff for keeping it a real config rather than a solution file (decision 14).
- [x] Vitest wired up with one trivial passing test

> Detail, decisions, and execution notes: [plan.phase-1.md](./plan.phase-1.md).

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
- [ ] Hidden side: **QR code always rendered**, plus **[■ Exit] [▶ Play/Pause] [↺ Restart]** buttons — Play/Pause toggles in-app audio, Restart replays from 0:00 (not next card), Exit ends the game session and redirects to the landing page
- [ ] Reveal side: title, artist, **year prominent** (Hitster's key value)
- [ ] In-app audio wired to the Phase 0 winner; if unavailable for a track, disable Play/Pause and Restart but keep the QR and Exit fully functional
- [ ] Pause/stop audio on flip/next/restart, and stop it on Exit — never let a track bleed into the next card or double up on itself

### Phase 5 — Gestures

- [ ] Swipe-to-next with velocity/offset threshold + snap-back below threshold
- [ ] Tap-to-flip, reliably distinguished from drag
- [ ] Stacked-deck visual (2–3 cards peeking) and exit animation
- [ ] Keyboard controls (Space = flip, → = next) for laptop/tablet play
- [ ] Verified on real iOS Safari + Android Chrome (touch is where this breaks)

### Phase 6 — Game Flow Screens

- [ ] Landing: URL input, validation, inline error states
- [ ] **Suggested-playlists section** on the landing screen — a handful of ready-to-try public playlist links so a first-time visitor doesn't need their own playlist to see the app work. Clicking one fills/submits the URL input exactly as if pasted. Reuse the Phase 0 spike playlists — already verified against the embed adapter, with genre/era variety and known preview coverage:
  - Today's Top Hits — `37i9dQZF1DXcBWIGoYBM5M`
  - Rock Classics — `37i9dQZF1DWXRqgorJj26U`
  - RapCaviar — `37i9dQZF1DX0XUsuxWHRQd`
  - Reggae Classics — `37i9dQZF1DXbSbnqxMTGx9`
  - All Out 80s — `37i9dQZF1DX4UtSsGT1Sbe`

  Editorial playlists like these get their tracks refreshed by Spotify periodically, so re-verify the IDs still resolve to the intended playlist (check `entity.uri` in the embed JSON, not just a 200) before shipping.

- [ ] Loading state showing year-resolution progress
- [ ] **Year review/edit screen** before Start (fix MusicBrainz mistakes)
- [ ] In-game HUD: cards remaining (Exit lives on the card itself, per Phase 4 — no separate End Game button)
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
- [x] Is a manual "paste track links" fallback wanted in v1 if the embed scrape proves unreliable? — **Resolved in Phase 0 (§5): no, deferred past v1.** A 100-tracks-exactly warning banner substitutes for it; see the track-source-mechanism decision.
- [ ] Should year review be mandatory before Start, or skippable with a "years may be off" warning?

---

## 7. Reference

- Reference implementation: <https://github.com/WhiteShunpo/hitster-card-generator> — Python/Streamlit, outputs print-ready A4 PDFs. **Not code-reusable** for this SPA, but valuable for: the no-API scraper approach, the original-release-year problem framing, and card layout/aesthetics.
- Spotify Feb 2026 migration guide: <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>
- Spotify July 2026 quota updates: <https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates>
- MusicBrainz API: <https://musicbrainz.org/doc/MusicBrainz_API> (1 req/s, `User-Agent` required)
