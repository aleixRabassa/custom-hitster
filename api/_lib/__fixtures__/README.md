# Spotify embed fixtures

Captured payloads for `api/_lib/spotify-embed.test.ts`. **These are trimmed, not verbatim captures** —
see the provenance table below for exactly what came from the wire and what was synthesised.

They exist because the embed endpoint is unofficial and unversioned (`plan.md` §2). When Spotify changes
it, the adapter's tests keep passing against these fixtures while production breaks — that is the point:
the fixtures pin the shape the adapter was written for, so a live failure is diagnosable by diffing
reality against them rather than by re-deriving what the payload used to look like.

## Provenance

| Captured                 | When       | From                                                                                |
| ------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| Healthy playlist         | 2026-08-04 | `open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M` (Today's Top Hits)         |
| 404-shaped body          | 2026-08-04 | `open.spotify.com/embed/playlist/0000000000000000000000` (well-formed, nonexistent) |
| Envelope / page skeleton | 2026-08-04 | Both of the above                                                                   |

Fetched with a normal browser `User-Agent`, which Phase 0 established is required.

## What is real and what is not

**Real, copied from the wire:** the `__NEXT_DATA__` envelope (`props`, `page`, `query`, `buildId`, …),
the playlist-level `entity` fields, the track-level field set and its exact key names, the 404-shaped
`pageProps`, and the page skeleton's shape — `__NEXT_DATA__` is the **last** of 15 `<script>` tags and
sits immediately before `</body></html>`, with the track list also rendered as visible `<h3>`/`<h4>`
markup earlier in the document.

For the two real tracks (`trackNormal`, `trackMultipleArtists`), the `uri`, `title`, `subtitle`,
`duration` and `audioPreview.url` are genuine captured values — an earlier draft of this file carried an
invented `uri` and preview URL for the second track, caught by running the adapter against the live
endpoint and diffing. The `uid` values are placeholders throughout: nothing reads them, and they are
per-playlist-position rather than per-track anyway.

**Synthesised, and why:**

| Synthesised                             | Why it had to be                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A track with **no `audioPreview`**      | All 150 tracks sampled on 2026-08-04 had one. The title/artist used is a real Phase 0 gap ("Uptown Top Ranking – Remastered 2001"), so the case is real even if this capture isn't. |
| A track with **`isPlayable: false`**    | Never observed on any sampled playlist, but Spotify documents the field and Phase 4 branches on it. `playabilityReason` follows the shape of the `PLAYABLE` values seen live.       |
| Tracks with a **missing `uri`/`title`** | Never observed. They exist to pin the defensive normalisation path, which is the one branch that would otherwise silently shrink a deck.                                            |
| The **exactly-100-track** payload       | Built by repeating one real track to reach the cap. Only the length matters for the truncation flag; the plan explicitly permits this.                                              |
| Track counts                            | The healthy fixture is trimmed to a handful. A verbatim 50- or 100-track capture makes the suite slow to read and horrible to diff, and adds no coverage.                           |

## Re-verifying

`docs/agent_findings.md` (2026-08-04) records the live re-verification of every field these fixtures
depend on. Re-run that check — not just these tests — when the adapter starts failing in production.
