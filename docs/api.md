# API — Vercel Functions (`api/`)

Every file under `api/` becomes a Vercel Function on the Node 24 runtime, routed at its path minus the extension (`api/hello.ts` → `/api/hello`). There is no router, no framework, and no middleware layer.

> **Status:** `/api/hello`, `/api/playlist` and `/api/year` are all **built**. Phase 2 is complete. `/api/year` gained its `stage` parameter, and with it the three-provider vote, on 2026-09-30; the stage-less request still answers exactly as before.

---

## 1. Endpoints

### `GET /api/hello` **[built]**

A hello-world function with no behaviour worth testing. It exists to establish the handler signature, the `@vercel/node` types, the relative `shared/` import, and `tsconfig.api.json` membership — **copy this shape for Phase 2 handlers.**

It ignores the request entirely (method, query, and body are all unread) and takes no parameters.

**Response** — `200 application/json`:

```json
{
  "ok": true,
  "message": "custom-jitster api is alive",
  "maxEmbedTracks": 100
}
```

`maxEmbedTracks` echoes `MAX_EMBED_TRACKS` from `shared/constants.ts`. It is not informational — it is the assertion that the shared constant **resolved** on the Node side, rather than merely type-checking. After any deploy that touches the layout, confirm it still returns `100`; that is the check that the cross-directory import survived the real function build.

**And actually make the request.** On 2026-08-04 this endpoint was found returning `500 FUNCTION_INVOCATION_FAILED` — its import lacked the `.js` extension an ESM function needs — after a clean build and five green local checks. It had shipped that way since 2026-08-03 because nobody had requested it. See [`agent_findings.md`](./agent_findings.md).

### `GET /api/playlist` **[built]**

Turns a pasted Spotify playlist link into a normalized deck.

**Query parameters**

| Parameter | Required | Notes                                                                               |
| --------- | -------- | ----------------------------------------------------------------------------------- |
| `url`     | yes      | Any accepted form below. A repeated `?url=` is tolerated — the first value is used. |

Every one of these is accepted, and all of them yield the same playlist ID (`parsePlaylistUrl()` in `shared/spotify-url.ts`, which the Phase 6 landing form reuses unchanged):

```
https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=…&utm_source=…#frag
https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M   ← locale prefix
http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M/           ← http, trailing slash
open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M                   ← no scheme
spotify:playlist:37i9dQZF1DXcBWIGoYBM5M                            ← desktop-client URI
37i9dQZF1DXcBWIGoYBM5M                                             ← bare ID
https://open.spotify.com/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5M          ← legacy path
https://open.spotify.com/intl-es/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5M  ← both prefixes
```

Surrounding whitespace is trimmed. Host matching is **anchored**, so look-alikes (`open.spotify.com.evil.example`, `notopen.spotify.com`, `open.spotify.com@evil.example`) are rejected rather than fetched.

The **legacy `/user/{user}/playlist/{id}` path** was added 2026-08-05. It had been rejected as `unsupported-entity` — the parser saw `user` in the entity position — which the 2026-08-04 findings called the clearest real bug that spike found: the URL carries a perfectly good 22-character ID. The `{user}` segment is skipped wholesale, so its contents do not matter. A bare `/user/{user}` profile link still reports `unsupported-entity`, which is what the length guard in `parsePlaylistUrl()` is for.

**Short links are resolved server-side.** A `spotify.link` URL carries no playlist ID at all — only a redirect does — so it cannot be parsed, by this endpoint or by the landing form:

```
https://spotify.link/aBcDeF12345        ← the phone share sheet's output
https://link.tospotify.com/aBcDeF12345  ← the legacy short host
```

`isSpotifyShortLink()` in `shared/spotify-url.ts` recognises one; `api/_lib/short-link.ts` then follows the redirects and hands the resolved URL back through `parsePlaylistUrl()` unchanged. This matters more than it looks: `spotify.link` is what a phone's Spotify share sheet produces, so it is the commonest way a player obtains a link at all.

The resolver is deliberately paranoid, because this is the **first place in the repo where user input decides an outbound request target** and a Vercel Function has unrestricted network access:

| Guard                                   | Why                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redirect: 'manual'`                    | The allow-list is consulted on **every hop**. With automatic following, `fetch` walks the chain itself and no intermediate host is checked                                |
| Host allow-list, matched **exactly**    | `spotify.link`, `link.tospotify.com`, `open.spotify.com`, `www.open.spotify.com`, `spotify.com`, `www.spotify.com`. An allow-list is the only direction that fails closed |
| http(s) only                            | `javascript:`, `file:` and `data:` targets are refused                                                                                                                    |
| Hop limit of 3                          | Also the loop guard — a chain can be infinite without ever repeating a URL, so a bound beats a visited-set                                                                |
| A descriptive `User-Agent` on every hop | Same one the embed adapter sends; a shortener may behave differently for an unidentified client                                                                           |

**Short-link failures add no new error codes** (a deliberate decision): a dead host, a refused hop, a hop-limit hit and a missing `Location` are all `upstream-unavailable`, and a short link that resolves to an album or a track falls through `parsePlaylistUrl()` as `unsupported-entity` naturally. So the table below is unchanged, and the client's message map needed no new entry.

Measured 2026-08-05: a real `spotify.link` chain is a **single 307** straight to `open.spotify.com`, and **`link.tospotify.com` no longer resolves** (ENOTFOUND). The dead host is still matched by the predicate on purpose — a legacy link genuinely _is_ a Spotify playlist link, so "Spotify could not be reached" is a more honest answer than "that does not look like a Spotify link".

**Response** — `200 application/json`, with `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`:

```json
{
  "playlist": { "id": "37i9dQZF1DXcBWIGoYBM5M", "name": "Today’s Top Hits", "owner": "Spotify" },
  "cards": [
    {
      "id": "70pVCVMGjmIWPbWXDwf11e",
      "title": "petal",
      "artist": "Ariana Grande",
      "durationMs": 184248,
      "isPlayable": true,
      "previewUrl": "https://p.scdn.co/mp3-preview/30dc1adb…"
    }
  ],
  "truncated": false,
  "skippedCount": 0
}
```

- `cards[].artist` is the artist string **verbatim**, never split — the separators Spotify joins with also occur inside real artist names ("Earth, Wind & Fire"). See `shared/artists.ts`.
- `cards[].previewUrl` is **omitted** when Spotify supplies no preview (~0.5% of tracks). Phase 4 disables Play/Pause and Restart for such a card; the QR still works.
- `cards[].isPlayable: false` tracks are **kept** in the deck. The QR code always works, so an unplayable track is still a playable card.
- `cards[].year` / `yearConfidence` are **never set here** — the embed payload has no release date at track level. `/api/year` fills them.
- `truncated: true` means the deck **may** be incomplete (exactly `MAX_EMBED_TRACKS` came back). It cannot mean more than "may": there is no pagination signal to check against. Phase 6 renders a non-blocking warning.
- `skippedCount` counts payload entries too malformed to become a card (no track ID, or no title). Normally `0`. **Phase 6 surfaces it** (decided 2026-08-04) as a non-blocking note beside the `truncated` warning, shown only when non-zero — a silently shorter deck is indistinguishable from a shorter playlist, which is the same problem `truncated` exists to solve.
- The response never contains upstream HTML, and never the anonymous Spotify bearer token the embed payload carries at `state.settings.session.accessToken`.

**Errors** — `application/json` as `{ "code": …, "message": … }`:

| `code`                 | Status | When                                                                              |
| ---------------------- | ------ | --------------------------------------------------------------------------------- |
| `invalid-url`          | 400    | `url` missing, empty, or not parseable as a Spotify playlist reference            |
| `unsupported-entity`   | 400    | A valid Spotify link to an album/track/artist/show/episode/user — not a playlist  |
| `not-found-or-private` | 404    | No public playlist for that ID. Private and deleted are indistinguishable (below) |
| `upstream-unavailable` | 502    | The embed request failed or returned non-200. **Transient** — a retry may work    |
| `unexpected-payload`   | 502    | The request worked but the payload was not the shape we parse. **Not transient**  |
| `method-not-allowed`   | 405    | Anything but `GET`. Sends an `Allow: GET` header                                  |
| `internal-error`       | 500    | An unexpected throw. Body is generic — never a stack trace                        |

#### Codes the CLIENT adds, which this endpoint never sends

`src/game/playlist-client.ts` renders from a wider union than the table above, and a reader comparing the two lists will otherwise assume the handler is missing entries. It is not: these four have no server-side existence, and adding them to `PlaylistErrorCode` would force this handler's exhaustive status table to answer for cases it cannot produce.

| `code`           | Produced when                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `network`        | The request did not complete — DNS, a dropped connection, a captive portal, or this app aborting it.                                                                                                                                                                                                                                                                                                         |
| `offline`        | The request was never **attempted**: `navigator.onLine` said there was no connection, so the client short-circuited before the fetch. Distinct from `network` on purpose — `onLine` reports a network interface, not reachability, so `network` stays as the fallback that catches a captive portal.                                                                                                         |
| `empty-playlist` | A well-formed **200 from this endpoint** describing a deck with no cards. **This handler does not reject that**, and that is worth knowing: `api/_lib/spotify-embed.ts` requires only that `entity.trackList` be an _array_, so an empty playlist — or one whose every track was skipped — is forwarded as a successful response with `cards: []`. The client owns the case and is the only layer that does. |
| `unknown-error`  | A completed request whose failure the client cannot name — including this handler's two **untyped** codes, `method-not-allowed` (405) and `internal-error` (500), neither of which is in `PlaylistErrorCode`.                                                                                                                                                                                                |

One further code, **`no-years-found`, is not an HTTP code at all** and never travels over the wire. It is produced by the game session when every card's `/api/year` lookup resolves to `null`, which empties the deck; `App.tsx` then returns the player to the landing screen with a warning. It shares the landing screen's one message slot, so it lives in the same copy map (`src/game/messages.ts`, typed `Record<StartFailureCode, string>` — a union deliberately wider than the client's own error union).

**The trap, and the single most reversion-prone line in this codebase:** a nonexistent playlist ID returns **HTTP 200** from Spotify, with `pageProps` carrying `{status: 404, title: "Page not found", …}` and **no `state` key**. The adapter therefore branches on the **presence of `pageProps.state`, never on the response status**. Status-based handling would report a missing playlist as a successful fetch of an empty deck — silently, all the way to the player. Measured in Phase 0, re-confirmed live 2026-08-04, and covered by the most important test in `api/_lib/spotify-embed.test.ts`.

`private` and `not-found` deliberately collapse into one code: Spotify gives no observable signal that separates them (it avoids leaking existence), so a `private` code would be a lie in the type system.

Track-level fields available from the embed payload (union across 150 sampled tracks): `uri`, `uid`, `title`, `subtitle`, `isExplicit`, `isNineteenPlus`, `contentRatings.labels[]`, `duration` (ms), `isPlayable`, `playabilityReason`, `audioPreview.{format,url}`, `entityType`. **There is no album name and no release date at track level** — which is why the year must come from `/api/year`, i.e. from MusicBrainz and, on the staged path, the Deezer and iTunes catalogues.

### `GET /api/year` **[built]**

Resolves ONE track's original release year, with a cache in front. The client sequences the calls, so progressive loading and "playable at card 1" fall out naturally.

**It has two paths, chosen by the `stage` parameter** (2026-09-30, [`plans/plan.year-fetch-rework-server.md`](./plans/plan.year-fetch-rework-server.md)):

- **`stage=resolve` / `stage=verify`, the staged path.** Three providers, Deezer, MusicBrainz and iTunes, and a vote over their answers. `resolve` asks Deezer and MusicBrainz in parallel and answers fast, possibly provisionally. `verify` asks iTunes, and is final unless a provider failed. See [The staged path](#the-staged-path-stageresolve--stageverify) below.
- **No `stage` at all, the legacy path.** MusicBrainz alone, **byte for byte what it was before the vote**. Everything from **Response** down to the error table below describes this path, and the MusicBrainz provider inside the staged path, which is the same `resolveYear()`. It stays because tabs still running the old client keep calling it: the service worker waits rather than calling `skipWaiting`, so such a tab lives until every tab of the app is closed. That client drops any card that comes back `null` and has never read `final`.

**Query parameters**

| Parameter    | Required | Notes                                                                                                                                                                                                                     |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`      | yes      | The track title as Spotify gives it, suffixes and all. Cleaned server-side. Max 300 chars.                                                                                                                                |
| `artist`     | yes      | The raw joined artist string (the card's `artist`). **Do not split it.** Max 300 chars.                                                                                                                                   |
| `durationMs` | no       | The card's `durationMs`. Absent, `0` or unparseable means "unknown" and is not an error.                                                                                                                                  |
| `stage`      | no       | `resolve` or `verify`. **Absent selects the legacy path.** Present but anything else, an empty `?stage=` included, is `400 invalid-request`, never a silent fall back to the legacy path, which answers a different body. |

`durationMs` is optional but **strongly recommended**: it becomes a `dur:` bound on the MusicBrainz query, and that bound is what makes the lookup accurate. It collapses the candidate pool below the 100-result page limit, so the original studio recording is actually in the results rather than ranked out of them — "Stairway to Heaven" is 842 candidates unbounded and 31 bounded, and it only resolves correctly in the second case. On the staged path it matters more: a store row verifies only when its length is within `DURATION_TOLERANCE_MS` of it (`shared/store-match.ts`), so **without `durationMs` neither Deezer nor iTunes can verify any row** and both answer `null`.

**Response (legacy path)** — `200 application/json`:

```json
{
  "year": 1982,
  "confidence": "high",
  "source": "release-group",
  "cached": false,
  "cleanedTitle": "Billie Jean",
  "stripped": { "remaster": false, "live": false, "feature": false, "version": false }
}
```

| Field          | Notes                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `year`         | The original release year, or `null` when nothing could be resolved. Phase 6 lets the player fill a null in by hand.                                                                                                     |
| `confidence`   | The weakest of two axes: the rung (① `official-release` → `high`, ② and ③ → `low`) and the artist match (exact → `high`, loosened → `low`). So `low` means "worth checking" and `high` requires both. `none` is no year. |
| `source`       | `release-group` for rungs ① and ②, `recording` for rung ③. **Omitted** when `year` is null.                                                                                                                              |
| `reason`       | `no-candidates` (the query matched nothing) or `no-dated-candidates` (matches existed, none dated). **Omitted** when a year was resolved. The two point at different fixes.                                              |
| `cached`       | `true` when the answer came from the year cache and cost no MusicBrainz request.                                                                                                                                         |
| `cleanedTitle` | The title actually queried, after suffix stripping. Returned deliberately: when a year looks wrong, the first question is always what was searched for.                                                                  |
| `stripped`     | Which suffix families were removed. **Diagnostic only** — a live-labelled track still resolves to the song's original year, because Hitster asks when the SONG came out.                                                 |

**Both caches are tiered by confidence** on the legacy path, since a `high` year is a historical fact while a `none` is the result most likely to improve. The Redis column is also the `mbyear:` entry the staged path reads:

| Tier   | Edge `s-maxage` | Redis TTL |
| ------ | --------------- | --------- |
| `high` | 30 days         | 30 days   |
| `low`  | 1 day           | 7 days    |
| `none` | 1 hour          | 1 day     |

**Redis is never shorter than the edge, on any tier**, and that rule is what sets the numbers: an edge miss is free because it falls through to Redis, while a Redis miss costs two MusicBrainz requests against a budget shared by every user. A test in `api/_lib/cache.test.ts` mirrors the edge column and fails if the two drift apart.

**There is no Spotify-year fallback**, contrary to what earlier drafts of this file and `plan.md` said: the embed payload carries no release date at track level (see `/api/playlist` above). The fallback is a three-rung MusicBrainz ladder instead, walked in order and stopping at the first rung that yields a year:

| Rung                 | Accepts                                                                              | Dated by                                   | Reports                  |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------ |
| ① `official-release` | `primary-type` ∈ Album / Single / EP, `status: Official`, no excluded secondary type | release-group `first-release-date`         | `high` / `release-group` |
| ② `studio-release`   | no excluded secondary type, `status` ≠ Bootleg                                       | release-group ?? recording ?? release date | `low` / `release-group`  |
| ③ `unfiltered`       | everything                                                                           | recording ?? release-group ?? release date | `low` / `recording`      |

A candidate must also pass the **artist filter**, which sits outside the ladder and produces the same pool on every rung. It has two strengths: an exact rule (whole-word containment), and — only when that admits nothing — a loose rule (same tokens, any order, at most one word of slack) that caps the result at `low`. That fallback exists because Spotify writes `Shakira, Burna Boy` where MusicBrainz writes `Shakira x Burna Boy`; it can only turn a `null` into a year, never one year into another.

**The ladder is free.** All three rungs are pure functions over the same already-fetched candidate pool, so walking all three costs no extra MusicBrainz request. There is deliberately **no pre-Start year review screen** — the player pastes the playlist, so listing years before Start would spoil the deck; `confidence` is consumed on the card's revealed side instead (see [`plans/plan.md`](./plans/plan.md) §6).

**Rung ① accepts `Single` and `EP`, and that is a 2026-08-11 reversal of an Album-only rule.** A release group's `first-release-date` is the date of the record, so an Album-only rung reports the year a song was _included on an album_ rather than the year it came out — Creep 1993 instead of 1992, Mr. Brightside 2004 instead of 2003, nothing at all for a song never issued on a studio album. Widening cannot overshoot, because the rung takes the **earliest** surviving date: a reissue single can never beat the album it postdates, so Billie Jean is still 1982 despite its January 1983 single.

**A lookup costs two MusicBrainz requests, and the second one is where the accuracy comes from.** The recording search inlines whichever _release_ matched, which is nearly always a reissue — filtering to official original releases and taking the earliest inlined release date gives Billie Jean **2012**, Bohemian Rhapsody **2001**, Sweet Child O' Mine **2018**. The second request is one **batched** `release-group?query=rgid:(… OR …)` lookup for each surviving group's `first-release-date`, which is the original release date and gets all three right. Because it is batched, the count stays at two however large the candidate pool. Measured 21 of 22 known-tricky tracks exact against a ~6% naive baseline; see [`agent_findings.md`](./agent_findings.md) (2026-08-04 and 2026-08-11) for the full method, the twenty-second track's structural limitation, and the things that look like tuning knobs and are not.

**A miss on the first query costs more, one request per query rung.** The recording search is itself a ladder of up to three queries, and each runs only when the one before it returned nothing: `duration-bounded` (full artist, `dur:` bound), `artist-guess` (the primary-artist guess, no bound, only when it differs from the full string) and `unbounded` (full artist, no bound). A card that the first query finds still costs exactly two requests. Since 2026-10-01 the guess comes before the unbounded full artist, because it finds a year far more often (68% of the cards that reach it, against 5%), and that cut MusicBrainz requests by 15.7% over 782 live cards (2.735 → 2.306 per card). The `tokenised` rung added on 2026-09-30 was removed at the same time, with its `low` cap: it answered 5 of the 782, all of them also answered by Deezer. See [`architecture.md`](./architecture.md) §3.

**A failed release-group request is now a 502, not a degraded year** (2026-09-30). Before, a busy gate or a failed request 2 returned a 200 with a `low` year from the relaxed rungs, dated by reissue dates, and cached it for seven days. Now the lookup fails with `upstream-unavailable`, or with `unexpected-payload` for a 200 that was not JSON, and nothing is cached. A busy gate at that point answers `upstream-unavailable` and **not** `rate-limited`, because the first request has already been spent. The client retries a 429 for free, so a 429 here would spend that request again, in a loop.

**Since 2026-10-01 that holds for every request after the lookup's first.** Query rungs 2–3 run only after an earlier query was spent and came back empty, so a busy gate before them used to answer `rate-limited` and the client restarted from query 1. Now only the first query keeps the gate's 1.5 s wait and the free 429. Every later permit of the lookup (rungs 2–3, the release-group request and the remix fallback's first query) waits up to ~3.5 s (`SPENT_LOOKUP_MAX_WAIT_MS`, about three lookups queued ahead at 1.1 s spacing), and a refusal after that is `upstream-unavailable`. The cost is idle function time, on a cold card whose first query missed, under contention only.

Because each request is a separate function invocation, the 1 req/s budget **cannot** be held by an in-process queue. It is enforced by a short-lived shared lock in Redis, which holds across concurrent instances and users; when the lock cannot be acquired before the first request the endpoint returns **429 with `retryAfterMs`** so the client backs off rather than the function blocking. Later in a lookup it waits longer and fails with a 502 instead, as above. Without Redis configured the gate degrades to per-instance pacing only — adequate for local development, not a real guarantee. **A cache hit skips the gate entirely**, so a replayed deck resolves at cache speed rather than at one track per two seconds.

**Errors (legacy path)** — `application/json` as `{ "code": …, "message": … }`:

| `code`                 | Status | When                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invalid-request`      | 400    | `title` or `artist` missing, empty, or over 300 characters                                                                                                                                                                                                                                 |
| `rate-limited`         | 429    | The 1 req/s gate was busy **before the first recording query, so nothing was spent**. Carries `retryAfterMs` and a `Retry-After` header. **Expected under load**                                                                                                                           |
| `not-configured`       | 500    | `MUSICBRAINZ_USER_AGENT` is unset. A deployment fault, reported on **every** request including hits                                                                                                                                                                                        |
| `upstream-unavailable` | 502    | MusicBrainz failed or returned non-200 after the single 503 retry, on any request. Also a gate still busy after ~3.5 s before any request after the first (query rungs 2–3, the release-group request), since 2026-10-01. Used to be a degraded `low` 200 before 2026-09-30. **Transient** |
| `unexpected-payload`   | 502    | It answered 200 with something we could not parse. **Not transient** — the adapter needs updating                                                                                                                                                                                          |
| `method-not-allowed`   | 405    | Anything but `GET`. Sends an `Allow: GET` header                                                                                                                                                                                                                                           |
| `internal-error`       | 500    | An unexpected throw. Body is generic — never a stack trace                                                                                                                                                                                                                                 |

A `429` is **not a bug**. It is the designed back-pressure signal: the client is expected to wait `retryAfterMs` and retry that card later.

**There is now a reference client for this contract: `src/game/year-client.ts` and `src/game/resolver.ts`** (Phase 3). Read them before writing another caller — between them they encode three things this table does not make obvious:

- A 429 neither settles nor skips a card. The resolver waits `retryAfterMs` (clamped into [500, 10000] ms, plus jitter) and comes back to the same card. A permanently rate-limited deployment therefore crawls forever by design, paced rather than spinning.
- **`not-configured` is recognised from the response BODY, never from the 500 status alone**, because `internal-error` shares that status and wants the opposite handling — one stops the whole crawl, the other is transient. A bodyless or unrecognised 500 degrades to `upstream-unavailable`.
- Under a cold deck, 429s are rarer than this section suggests: a single sequential loop paced at ~1.1 s/lookup never contends with itself, and a real 42-card crawl saw **zero** (2026-08-05). The gate exists for concurrent _users_, which is exactly why it cannot be an in-process queue.

#### The staged path (`stage=resolve` / `stage=verify`)

Built 2026-09-30 from [`plans/plan.year-fetch-rework-server.md`](./plans/plan.year-fetch-rework-server.md). Its client is plan 3, [`plans/plan.year-fetch-rework-game.md`](./plans/plan.year-fetch-rework-game.md). Three providers answer, and a vote decides:

| Step | Provider    | Stage     | Why here                                                                    |
| ---: | ----------- | --------- | --------------------------------------------------------------------------- |
|    1 | Deezer      | `resolve` | Fast: ~2 requests and ~0.25 s a card                                        |
|    2 | MusicBrainz | `resolve` | Coverage: the only source whose date means "first release" on old catalogue |
|    3 | iTunes      | `verify`  | Precision, but ~20 requests a minute for every player together              |

Steps 1 and 2 are asked **in parallel**. **A year is confirmed once two different providers agree on it, and no further provider is asked.** So when Deezer and MusicBrainz agree at `resolve`, the answer is final there, and a later `verify` for the same card reads it back from the cache with no provider request. When nobody agrees, the card keeps one provider's year, marked unconfirmed, in this order: MusicBrainz `high`, then iTunes, then MusicBrainz `low`, then Deezer (only when its release-date year equals its ISRC year). The order, the vote and the reasons for both live in `shared/year-providers.ts`; see [`architecture.md`](./architecture.md) §3, "The provider vote".

**One call, in order:**

1. **One batched cache read** (Upstash `MGET`) of every provider's cached answer, the MusicBrainz `mbyear:` entry included. If the cached answers already confirm a year, or no provider is left to ask, the call ends here with `cached: true`. A warm card costs exactly one Redis command.
2. **Ask** the providers the planner names, one frontier at a time, each frontier concurrently. **`verify` runs `resolve`'s frontiers first**: with a warm cache they are empty, so `verify` asks only iTunes. When the cache does not hold them (an expired entry, a `resolve` whose MusicBrainz failed or was busy, or `vercel dev`), `verify` asks Deezer and MusicBrainz again, because it is the stage the client treats as the last word. **`verify` reads `resolve`'s answers from the shared cache, never from the client**, so no client can put a year into the cache.
3. **Decide** the vote over every answer, and whether it is final.

**Response (staged path)** — `200 application/json`:

```json
{
  "year": 1982,
  "confidence": "high",
  "cached": false,
  "cleanedTitle": "Billie Jean",
  "stripped": { "remaster": false, "live": false, "feature": false, "version": false },
  "final": true,
  "source": "vote",
  "agreedBy": ["deezer", "musicbrainz"]
}
```

| Field                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `year`                     | The vote's year, or `null` when no provider has one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `final`                    | **Required. The only field the client reads to tell pending, provisional and final apart.** `true` when no later call can change the answer: a confirmation was reached, or no provider failed and every provider of the plan has answered or is not configured. So `resolve` is final only on a confirmation, or when iTunes' answer was already cached. `verify` is final unless a provider failed. **A transient failure never produces a final "no year"**: a final `null` drops the card, and an outage must not shrink decks. |
| `confidence`               | `high` means confirmed by two providers, and is always final. `low` means one provider's lone year, kept by the order above; it may be final or provisional, so read `final`. `none` means no year. It keeps its three values because it is saved on the card and read by the reveal.                                                                                                                                                                                                                                               |
| `source`                   | **Widened.** `vote` when confirmed. Otherwise the kept provider: `release-group` or `recording` for a MusicBrainz year (its own two signals, as on the legacy path), `deezer`, or `itunes`. **Omitted** when `year` is null.                                                                                                                                                                                                                                                                                                        |
| `agreedBy`                 | The two providers that agreed, in plan order. Present only when the year is confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `skipped`                  | The providers left out of this call, in plan order: those not configured, those that failed transiently, **and** those that refused us themselves (an iTunes 403 or a Deezer quota error, code 4; since 2026-10-01). Present only when non-empty. A provider the stage never asks (iTunes on `resolve`) is not "skipped".                                                                                                                                                                                                           |
| `retryAfterMs`             | Present only on a **non-final `resolve`** decided while a provider was busy (2026-10-01): the wait the 429 would have carried, the longest when several were busy. The client shows the year, hands the card to `verify`, and sleeps this long before its next `resolve` request, uncounted, as on a 429.                                                                                                                                                                                                                           |
| `cached`                   | **Redefined**: `true` when this call made **no** provider request, so every answer came from a cache. A failed request counts as a request.                                                                                                                                                                                                                                                                                                                                                                                         |
| `cleanedTitle`, `stripped` | As on the legacy path. Cleaned once, by the driver.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `viaTitle`                 | Present only when the kept year is a lone MusicBrainz answer found through a rewritten title.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `reason`                   | **Never present on the staged body.** Only MusicBrainz knows one, and a staged `null` is the whole vote's, not one provider's.                                                                                                                                                                                                                                                                                                                                                                                                      |

**Errors (staged path)** — the same `{ "code": …, "message": … }` shape, with a separate set of messages, because three of the legacy messages name MusicBrainz:

| `code`                 | Status | When                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid-request`      | 400    | As on the legacy path, **or `stage` is present and is neither `resolve` nor `verify`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `rate-limited`         | 429    | **Back-pressure from one provider's gate** (for MusicBrainz, only before a lookup's first query; a gate busy later in its lookup is a failure, as on the legacy path). Also from the provider saying it is busy: Deezer's service-busy body (`{"error":{"code":700}}` served with **HTTP 200**), a Deezer 429 or an iTunes 429, which are retried with no cap like a full gate (`retryAfterMs` from the provider's `Retry-After` when sent, else 5 s for Deezer and 30 s for iTunes). **Not when the provider shuts us out** (2026-10-01): Deezer's quota body (`{"error":{"code":4}}`, HTTP 200) and an iTunes 403 are a _refusal_. The provider is left out of the call, listed in `skipped`, and the vote decides without it, so the answer can be final; a final reached that way gets the 60 s edge window, which is what lets it heal. Carries `retryAfterMs` from whichever gate was busy, the longest when several were, and a `Retry-After` header in whole seconds. The answers the same call did obtain are cached, so the next call resumes from them. **Not on a `resolve` with an answer in hand** (2026-10-01): there it is a `200` with `final: false`, `no-store`, carrying the same `retryAfterMs` in the body (no `Retry-After` header) unless the answers in hand confirmed a year. `verify` always answers 429 here. |
| `upstream-unavailable` | 502    | **Only when every provider asked failed and nothing answered**, cached answers included. A partial failure is **not** a 502: it is a `200` with `final: false` and the failed provider in `skipped`, because a provisional year is worth showing while the client retries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `not-configured`       | 500    | **Only when every provider in the plan reports `not-configured`.** `resolve` never asks iTunes, so only `verify` can return it. Neither store needs a variable, so with the shipped adapters it cannot happen at all. MusicBrainz alone unconfigured is a skip with a warning (§4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `method-not-allowed`   | 405    | Anything but `GET`. Sends an `Allow: GET` header                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `internal-error`       | 500    | An unexpected throw. Body is generic — never a stack trace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

The staged path **never answers `unexpected-payload`**: one provider's unparseable answer is one more failure, and the rows above decide what that means.

**The edge cache on the staged path** is set per answer, by `stagedEdgeMaxAgeSeconds()` in `api/_lib/cache.ts`:

| Answer                                        | `s-maxage`                                                           | `stale-while-revalidate`  |
| --------------------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| Final, nothing in `skipped`                   | The **shortest** Redis TTL among the cache entries it was built from | The same, capped at 1 day |
| Provisional after a failed or busy provider   | `Cache-Control: no-store`                                            | —                         |
| Provisional, or final with anything `skipped` | 60 s (`PROVISIONAL_EDGE_SECONDS`)                                    | 60 s                      |

This is the legacy "Redis is never shorter than the edge" rule, restated per answer. The vote is recomputed from its cache entries on every call, so the edge must not keep serving a vote after the first entry under it could have expired and changed it. A final reached while a provider was skipped is final only while that provider stays skipped, so the edge holds it for a minute, not a month. A provisional answer built on a failure or a busy provider is not held at all: the client's verify lane retries the same URL within a second, and an edge copy would hand every retry the same failure until the card settled exhausted. `should never let the edge outlive the entries an answer was built from` in `api/_lib/cache.test.ts` checks both paths.

**The per-provider answer cache.** Deezer's and iTunes' answers are cached one per provider under `yearprov:<provider>:v1:<artist>|<cleaned title>`, 30 days for an answer with a year and 1 day for a `null`. MusicBrainz keeps its own `mbyear:` entry, written by `resolveYear()` exactly as on the legacy path, with the tiered TTLs above. A failure or a busy provider is never cached, and neither is an answer from a lookup with no `durationMs` (it can verify no store row, and the key carries no duration). Such a lookup makes no store request either: the adapters answer `null` with no gate permit and no fetch, and may still read another card's cached answer. No key encodes the provider order, so reordering the plan invalidates nothing.

**Pacing.** Each provider has its own global gate (`PROVIDER_GATES` in `api/_lib/rate-limit.ts`): MusicBrainz 1.1 s (the same `mbgate:v1` lock as the legacy path, because MusicBrainz counts requests, not endpoints), Deezer 120 ms, iTunes 3 s. Each waits at most 1.5 s for a permit. For iTunes that is shorter than its interval, so a second concurrent caller gets a 429 rather than being held inside a metered invocation.

---

## 2. Layout

```
api/
  hello.ts                      GET /api/hello    — reference shape, copy this
  playlist.ts                   GET /api/playlist — playlist ingestion
  year.ts                       GET /api/year     — year resolution
  _lib/                         NOT routed — server-only helpers
    spotify-embed.ts              the embed adapter (all scraping lives here)
    musicbrainz.ts                the MusicBrainz adapter (all HTTP + response shape)
    resolve-year.ts               cache -> gate -> strict -> relaxed, orchestrated
    musicbrainz-provider.ts       resolveYear() wrapped whole as one ProviderLookup
    deezer.ts                     the Deezer adapter: free-text search, then track/{id}
    itunes.ts                     the iTunes Search adapter: one request, storefront ES
    store-http.ts                 the one GET both store adapters share: permit, status mapping
    provider-lookup.ts            the ProviderLookup contract and the registry type
    year-pipeline.ts              runStage(): the thin driver of ?stage=resolve|verify
    cache.ts                      YearCache + ProviderAnswerCache over ONE store, memory + Upstash
    rate-limit.ts                 one keyed gate per provider (PROVIDER_GATES), Redis or per-instance
    *.test.ts
    __fixtures__/                 trimmed captured payloads + provenance headers
```

Files under `api/` are type-checked **only** by `tsconfig.api.json` (`pnpm typecheck:api`), which supplies Node types and **no DOM lib**. A new function is not covered by the app typecheck at all, so it must live under `api/` to be checked.

**`_`-prefixed paths are not routed.** `api/_lib/` holds server-only helpers, tests and fixtures beside the function that uses them without any of it becoming an endpoint. This is a Vercel convention rather than something this repo can verify locally — `typecheck`, `lint`, `test` and `build` all pass whether or not it holds — so it was settled by a throwaway probe deploy on 2026-08-04: a named-export-only file at `api/_lib/_probe.ts` returned **404 `NOT_FOUND`** and did not break the function build. Recorded in [`agent_findings.md`](./agent_findings.md); the documented fallback, if this ever changes, is a root-level `server/` tree added to `tsconfig.api.json`'s `include`.

Server-only helpers **cannot** live in `shared/`: `tsconfig.app.json` supplies only `vite/client` types, so any `process.env` reference there fails `pnpm typecheck:app`. "Just put it in shared" is the obvious wrong move.

---

## 3. Handler conventions

`api/hello.ts` in full, as the canonical example:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// The `.js` is required, not stylistic -- see the rule table below.
import { MAX_EMBED_TRACKS } from '../shared/constants.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    message: 'custom-jitster api is alive',
    maxEmbedTracks: MAX_EMBED_TRACKS,
  });
}
```

Rules this establishes:

| Rule                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default-export a single `handler` function**                   | Vercel's Node runtime entry contract.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Type params as `VercelRequest` / `VercelResponse`**            | From `@vercel/node`, a dev dependency.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Import `shared/` by RELATIVE path — never `@/`**               | Vercel does not support tsconfig path mappings for functions. An aliased import type-checks locally and **fails at deploy time**.                                                                                                                                                                                                                                                                                                                                       |
| **End relative imports with `.js`** (`'../shared/constants.js'`) | **Corrected 2026-08-04 — this table previously said the opposite.** `"type": "module"` makes a deployed function ESM, and Node's ESM resolver does not guess extensions; Vercel transpiles rather than bundles, so the specifier reaches Node verbatim. Extensionless gives `FUNCTION_INVOCATION_FAILED` at runtime after a clean build, and **no local check catches it** — that is precisely how `/api/hello` shipped broken. Type-only imports erase and are exempt. |
| **No DOM APIs**                                                  | `tsconfig.api.json` omits the DOM lib, so `document`/`window` fail with `TS2584`.                                                                                                                                                                                                                                                                                                                                                                                       |
| **Prefix unused params with `_`**                                | `noUnusedParameters` is on; `@typescript-eslint/no-unused-vars` also reports them.                                                                                                                                                                                                                                                                                                                                                                                      |
| **Never put secrets in `api/` source**                           | The Vite dev server serves that source as transpiled text — see [`architecture.md`](./architecture.md) §5.                                                                                                                                                                                                                                                                                                                                                              |

Node globals (`process`, etc.) are available: `eslint.config.js` gives `api/**/*.ts` the Node globals block, and `tsconfig.api.json` supplies `@types/node`.

---

## 4. Configuration reference

All values but one are read server-side only. Copy `.env.example` to `.env.local` and fill it in; `.env*.local` is gitignored. The three in the table are consumed by `/api/year`; nothing else reads any of them. **The exception is `VITE_PRELOADED_YEARS`** (2026-10-01), a load-testing switch read by the browser bundle: `off` makes a deal skip the suggested playlists' preloaded years, so every card asks `/api/year`; unset or any other value leaves the preload on. Vite inlines it at **build** time, so changing it on Vercel takes a redeploy ([`decisions.md`](./decisions.md) § Decks). **Deezer and iTunes need no variable at all** (both are keyless public search APIs), and there is none for Discogs, which was measured and dropped. The iTunes storefront is a constant in `api/_lib/itunes.ts`, not a variable.

| Variable                   | Required                                               | Where to get it                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | Production only                                        | Create a Redis database at [upstash.com](https://upstash.com/), or provision Upstash Redis through the Vercel Marketplace, which injects it automatically.                                                                |
| `UPSTASH_REDIS_REST_TOKEN` | Production only                                        | Same place — shown alongside the REST URL.                                                                                                                                                                                |
| `MUSICBRAINZ_USER_AGENT`   | Set it everywhere, but **optional** on the staged path | You write it. Format `AppName/Version ( contact )`. MusicBrainz rate-limits to 1 req/s and blocks anonymous traffic. Unset, the staged path skips MusicBrainz **with a warning** and the legacy path answers 500 (below). |

**What actually happens when each one is missing** — this is the table to read before concluding something is broken:

| Missing                         | Runtime consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MUSICBRAINZ_USER_AGENT`        | **Two answers, one per path, on purpose.** The **legacy** stage-less path returns **500 `not-configured`** on every call with an explicit message — including calls that would have hit the cache, so the fault is consistent rather than intermittent. Nothing is sent to MusicBrainz. The **staged** path skips MusicBrainz: it logs `[year-pipeline] musicbrainz skipped: MUSICBRAINZ_USER_AGENT is not set on this deployment` once per cold start (the variable's name, never its value), lists `musicbrainz` in `skipped`, and answers from Deezer and iTunes, with less coverage of old catalogue. It still uses a MusicBrainz answer already cached under `mbyear:`. Both follow one rule, "only every provider skipped is loud": the legacy path has only one provider, so skipping it _is_ every provider skipped. Do not "fix" one path to match the other. |
| Both Upstash variables          | The cache falls back to **in-memory** and all three gates to **per-instance pacing**, both logged at cold start. Lookups still work. In production it means a cache that never shares and no real global limit for any provider. **Under `vercel dev` it means neither functions at all** — that server runs a fresh process per invocation, so the cache never hits, `verify` re-asks every provider, and no gate paces anything, iTunes included. Read [`development.md`](./development.md) §4 before resolving a whole deck locally.                                                                                                                                                                                                                                                                                                                                |
| `UPSTASH_REDIS_REST_URL` only   | Same in-memory fallback, but logged as a **warning** rather than an info line, since a half-configured deployment is almost certainly a mistake.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `UPSTASH_REDIS_REST_TOKEN` only | Ignored entirely — selection keys on the URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Both cache variables are production-only because local development falls back to an in-memory cache. The two log lines at cold start (`[year-cache] …` and `[rate-limit] …`) exist precisely so this fallback is never silent: an in-memory cache in production looks exactly like a correctly wired cache that simply never hits.

Upstash names were chosen over Vercel KV names deliberately: Vercel KV is now provisioned _as_ Upstash Redis through the Marketplace, so these names are the more durable choice.

**There are no Spotify credentials.** See [`architecture.md`](./architecture.md) §4 before adding any.

---

## 5. Error handling

**Lead with the trap: the embed endpoint signals "not found" inside a 200 response body.** A request for a playlist that does not exist returns HTTP **200** whose `pageProps` carries `{status: 404, …}` and no `state` key. Status-code-based error handling therefore treats a missing or private playlist as a _success_ and hands the UI an empty deck — silently, with no error anywhere. Always branch on the presence of `pageProps.state`. This is measured (Phase 0, re-confirmed live 2026-08-04), it reads like a bug to anyone who has not seen the payload, and it is guarded by a dedicated test.

### The shape

Every failure is a typed `code` — `PlaylistErrorCode` or `YearErrorCode`, both closed unions in `shared/types.ts` — sent as `{ "code": …, "message": … }`. Each union is closed so that the handler's status mapping and Phase 6's inline messages both stay exhaustive; each member is documented next to its HTTP status in that file. Per-endpoint tables are under §1.

### Rules

- **Typed codes, not free text.** Phase 6 renders a different message per code — "that's an album, not a playlist" is a different screen from "that isn't a Spotify link" — so a collapsed error type would degrade the landing page.
- **Separate transient from broken.** `upstream-unavailable` (retry may help) and `unexpected-payload` (the scrape broke, someone must look) share status 502 but never share a code. That distinction is operational, and it is the reason both exist.
- **Never echo upstream content.** Not the raw HTML (unbounded), not a parse error, and above all not the anonymous Spotify bearer token the embed payload carries at `state.settings.session.accessToken`. Messages are hand-written constants in the handler; an adapter test asserts the token never reaches the output.
- **Adapters return unions, handlers map to status.** `parsePlaylistUrl()`, the embed adapter, the MusicBrainz adapter, `resolveYear()` and `runStage()` all return `{ok: true, …} | {ok: false, code}`, and the three year providers return a `ProviderOutcome` (`answer` / `skipped` / `failed` / `busy`); none of them throws, so the handler is a pure translation layer. Every handler is also wrapped so an unexpected throw becomes a generic 500 rather than a stack trace.
- **Guard the method.** Anything but the documented verb gets 405 with an `Allow` header.

### Two rules the year endpoint adds

- **429 is a signal, not a failure.** `rate-limited` means a shared gate was busy (the 1 req/s MusicBrainz gate, or on the staged path any provider's own gate), which is the _expected_ outcome when several cards resolve at once. It carries `retryAfterMs` and a `Retry-After` header, and Phase 3's loop is built to back off on it. Treating it as an error state in the UI would surface normal operation as breakage.
- **Fail loudly on misconfiguration, degrade quietly on infrastructure.** On the legacy path a missing `MUSICBRAINZ_USER_AGENT` is a 500 on every request, because nothing can work without it and a remote rejection from MusicBrainz is far harder to diagnose. On the staged path every provider is skippable with a warning, MusicBrainz included, and only "every provider in the plan is not configured" is the loud 500 (the developer's decision, 2026-09-30); the skip is still visible, in the cold-start warning and in `skipped`. A missing or broken cache, by contrast, degrades silently to a miss and a broken rate-limit gate fails **open** — the cache is a latency optimisation and MusicBrainz is the source of truth, so an Upstash outage must make the app slow, not broken.
