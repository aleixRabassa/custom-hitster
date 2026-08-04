/**
 * The Spotify embed adapter — the ONLY module in the repo that knows the track list
 * comes from scraping an HTML page.
 *
 * Everything Phase 0 measured about this endpoint is encoded here and nowhere else, so
 * when Spotify changes it (and it will — the endpoint is unofficial and unversioned,
 * `plan.md` §2) the blast radius is exactly one file with its own fixture-backed tests.
 * That containment is the mitigation `plan.md` §4 prescribes for "embed endpoint
 * changes/breaks".
 *
 * `fetch` is injected rather than imported so every error branch below is testable
 * offline against captured fixtures. Nothing here reads `process.env`.
 */

import type {
  Card,
  PlaylistErrorCode,
  PlaylistResult,
  PlaylistSummary,
} from '../../shared/types.js';
import { MAX_EMBED_TRACKS } from '../../shared/constants.js';

/**
 * The subset of `PlaylistErrorCode` this adapter can produce — the URL-shaped codes
 * belong to `parsePlaylistUrl()`, which runs before we get here. Derived from the full
 * union so the two cannot drift.
 */
export type SpotifyEmbedErrorCode = Extract<
  PlaylistErrorCode,
  'not-found-or-private' | 'upstream-unavailable' | 'unexpected-payload'
>;

export type SpotifyEmbedResult =
  ({ ok: true } & PlaylistResult) | { ok: false; code: SpotifyEmbedErrorCode };

/** The minimum of `Response` this adapter touches. The global `fetch` satisfies it. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

/** The minimum of `fetch` this adapter needs. Keeping it structural is what makes the test doubles one-liners. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchResponseLike>;

/**
 * Phase 0 fetched with a normal browser `User-Agent` and got HTTP 200. Whether a default
 * or absent agent behaves the same was never tested, so do not assume it does — send one.
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * The payload lives in a single `<script>` tag with a known `id`, and its content is
 * JSON — so a non-greedy match plus `JSON.parse` covers it and an HTML-parser dependency
 * would only add cold-start weight on a latency-sensitive path.
 *
 * The naive `</script>` terminator is safe because Next.js escapes every `<` inside
 * `__NEXT_DATA__` as a unicode escape (backslash-u003c), precisely so embedded content
 * cannot close the tag early. Without that guarantee this would be a bug waiting for the first track title
 * containing a literal `</script>`. (Not directly observed in the 2026-08-04 captures --
 * no sampled title contained `<` -- so this rests on documented Next.js behaviour rather
 * than on a measurement, and `JSON.parse` failing loudly is the fallback either way.)
 *
 * Non-greedy matters for a second reason: the real page has **14 other script tags before
 * this one**, several containing JSON, so a greedy `(.*)` would run past the payload to
 * the document's last `</script>`.
 *
 * Matching the attributes in this exact order is a deliberate tightness/looseness
 * trade-off: if Spotify reorders them this returns `unexpected-payload`, which is a loud,
 * diagnosable failure — much better than a loose match that silently grabs a different
 * script.
 */
const NEXT_DATA_PATTERN = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;

/**
 * Track URIs look like `spotify:track:{id}`.
 *
 * Deliberately MORE permissive than the 22-character check in `shared/spotify-url.ts`,
 * and the asymmetry is intentional: rejecting a playlist URL shows the user an error they
 * can act on, whereas rejecting a track here silently shrinks their deck. Anything
 * base62 and non-empty is accepted, since the QR code only needs to round-trip it. Local
 * files (`spotify:local:…`) fail this and are skipped, which is correct — they have no
 * shareable track page.
 */
const TRACK_URI_PATTERN = /^spotify:track:([0-9A-Za-z]+)$/;

/**
 * Fetch a playlist's tracks from the public embed endpoint and normalize them to cards.
 *
 * Returns a discriminated union instead of throwing, matching `parsePlaylistUrl()`, so
 * the handler's job is a pure code-to-status mapping.
 *
 * No timeout and no retry: one attempt, mapped to a typed error (retry/backoff is
 * explicitly out of scope for this plan). Vercel's function timeout is the backstop if
 * the upstream hangs.
 */
export async function fetchPlaylistFromEmbed(
  playlistId: string,
  fetchImpl: FetchLike,
): Promise<SpotifyEmbedResult> {
  let response: FetchResponseLike;
  let html: string;

  try {
    response = await fetchImpl(`https://open.spotify.com/embed/playlist/${playlistId}`, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });

    // A non-200 here is a genuine upstream problem, and it is NOT how a missing playlist
    // arrives -- see the `state` branch below.
    if (!response.ok) return { ok: false, code: 'upstream-unavailable' };

    html = await response.text();
  } catch {
    // Network failure, DNS, socket reset, a body that could not be read. Transient, so
    // it is kept distinct from `unexpected-payload`: this one may work on a retry.
    return { ok: false, code: 'upstream-unavailable' };
  }

  const match = NEXT_DATA_PATTERN.exec(html);
  // No payload script at all: a redesign, an interstitial, or a captcha wall. Not
  // transient -- someone has to look at it.
  if (!match?.[1]) return { ok: false, code: 'unexpected-payload' };

  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return { ok: false, code: 'unexpected-payload' };
  }

  const pageProps = asRecord(getPath(payload, 'props', 'pageProps'));
  if (!pageProps) return { ok: false, code: 'unexpected-payload' };

  // =========================================================================
  //  BRANCH ON `state`, NEVER ON THE HTTP STATUS CODE.
  //
  //  Phase 0 measured this and it was re-confirmed live on 2026-08-04: a request
  //  for a playlist that does not exist returns **HTTP 200**, and its `pageProps`
  //  carries `{status: 404, title: "Page not found", …}` with NO `state` key.
  //
  //  This reads like a mistake if you have not seen the payload, and it is the most
  //  reversion-prone line in this file. Status-based handling would present a missing
  //  or private playlist to the player as a SUCCESSFUL fetch of an empty deck.
  //
  //  Private and deleted playlists collapse into one code on purpose: Spotify gives
  //  no observable signal that separates them (it avoids leaking existence), so a
  //  `private` code would be a lie in the type system.
  // =========================================================================
  const state = asRecord(pageProps['state']);
  if (!state) return { ok: false, code: 'not-found-or-private' };

  const entity = asRecord(getPath(state, 'data', 'entity'));
  if (!entity) return { ok: false, code: 'unexpected-payload' };

  // Cheap identity assertion, earned the hard way: during Phase 0's own spike two
  // parallel agents wrote to the same scratch file and silently analysed the WRONG
  // playlist -- one caught it via `entity.name`, one did not. This turns a silent
  // wrong-deck into a loud error for the cost of a string comparison.
  if (entity['uri'] !== `spotify:playlist:${playlistId}`)
    return { ok: false, code: 'unexpected-payload' };

  const trackList = entity['trackList'];
  if (!Array.isArray(trackList)) return { ok: false, code: 'unexpected-payload' };

  const cards: Card[] = [];
  let skippedCount = 0;

  for (const entry of trackList) {
    const card = toCard(entry);
    if (card) cards.push(card);
    else skippedCount += 1;
  }

  return {
    ok: true,
    playlist: toPlaylistSummary(entity, playlistId),
    cards,
    // Compared against the length of the RAW list, not the normalized cards: skipping a
    // malformed entry must not make a truncated playlist look complete.
    //
    // Phase 0 established the cap by observing real truncation, and separately that the
    // payload carries NO pagination signal -- no total, no offset, no `hasMore` -- and
    // that the leaked anonymous token is quota-exhausted, so paging is not available by
    // any route. A boolean "this may be incomplete" is therefore the honest maximum this
    // layer can report. Do not re-litigate the number here; it lives in
    // `shared/constants.ts` with its evidence.
    truncated: trackList.length === MAX_EMBED_TRACKS,
    skippedCount,
  };
}

/**
 * Normalize one `trackList` entry, or return `undefined` if it cannot yield a usable card.
 *
 * Only two things disqualify an entry: no derivable track ID, and no title. Everything
 * else degrades to a default, because a card with an odd duration is still playable while
 * a card with no title is a blank on the reveal side.
 */
function toCard(entry: unknown): Card | undefined {
  const track = asRecord(entry);
  if (!track) return undefined;

  const uri = typeof track['uri'] === 'string' ? track['uri'] : '';
  const id = TRACK_URI_PATTERN.exec(uri)?.[1];
  if (!id) return undefined;

  // The payload has no bare `id` at track level, so the URI is the only source.
  const title = typeof track['title'] === 'string' ? track['title'].trim() : '';
  if (title === '') return undefined;

  const previewUrl = asRecord(track['audioPreview'])?.['url'];
  const duration = track['duration'];

  const card: Card = {
    id,
    title,
    // VERBATIM, never split. `subtitle` is the artist name(s) as one joined string, and
    // the separators Spotify joins with also occur inside real artist names -- splitting
    // would render "Earth, Wind & Fire" as three artists and corrupt the reveal side of
    // the card, which is the payoff of the whole game. See `shared/artists.ts`.
    artist: typeof track['subtitle'] === 'string' ? track['subtitle'] : '',
    durationMs:
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0,
    // `isPlayable: false` is KEPT in the deck, not filtered out. The QR code is always
    // rendered and always works (`plan.md` §2, non-negotiable), so an unplayable track is
    // still a fully playable card -- only Phase 4's Play/Pause and Restart are affected.
    // Absent means playable: the QR works either way, so the permissive default is right.
    isPlayable: track['isPlayable'] !== false,
  };

  // Left absent rather than set to undefined, so the JSON response omits the key
  // entirely and Phase 4 can branch on its presence.
  if (typeof previewUrl === 'string' && previewUrl !== '') card.previewUrl = previewUrl;

  return card;
}

/**
 * Playlist-level metadata. `name` and `title` are both present and identical in every
 * payload observed; `name` is preferred with `title` as the fallback.
 */
function toPlaylistSummary(entity: Record<string, unknown>, playlistId: string): PlaylistSummary {
  const name =
    typeof entity['name'] === 'string' && entity['name'] !== '' ? entity['name'] : entity['title'];

  return {
    id: typeof entity['id'] === 'string' && entity['id'] !== '' ? entity['id'] : playlistId,
    name: typeof name === 'string' ? name : '',
    // Playlist-level `subtitle` is the owner label: "Spotify" for editorial playlists, a
    // display name for personal ones. Not to be confused with TRACK-level `subtitle`,
    // which is the artist string.
    owner: typeof entity['subtitle'] === 'string' ? entity['subtitle'] : '',
  };
}

/** Narrow an unknown to an indexable object, excluding arrays and `null`. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Walk a path through nested unknown objects without a chain of casts at each call site. */
function getPath(root: unknown, ...keys: string[]): unknown {
  let current: unknown = root;
  for (const key of keys) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}
