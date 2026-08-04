/**
 * Constants shared by the browser app (`src/`) and the serverless functions (`api/`).
 *
 * `api/` must import this module by RELATIVE path, never through the `@/` alias --
 * Vercel does not support tsconfig path mappings when compiling functions -- and the
 * specifier must carry an explicit `.js` extension (`'../shared/constants.js'`),
 * because a deployed function is ESM and Node's ESM resolver does not guess
 * extensions. Extensionless fails only at runtime, only on Vercel, with a clean build.
 * See AGENTS.md and docs/architecture.md §2.
 */

/**
 * Maximum number of tracks the Spotify embed endpoint will return for a playlist.
 *
 * Source: the Phase 0 spike (see `plan.md` §5, Phase 0), which established this by
 * observing actual truncation rather than by assumption -- the "Rock Classics"
 * playlist (`37i9dQZF1DWXRqgorJj26U`), independently reported to hold 200 tracks,
 * returned exactly 100 `trackList` entries.
 *
 * The critical consequence for Phase 2: the payload carries **no pagination signal**
 * of any kind -- no total, no offset, no `hasMore`. A response of exactly 100 tracks
 * is therefore indistinguishable from a playlist that genuinely has 100 tracks, so
 * the deck cannot be known to be complete. Phase 0 resolved this by surfacing a
 * non-blocking warning when `trackList.length === MAX_EMBED_TRACKS` instead of
 * building a manual-paste fallback.
 */
export const MAX_EMBED_TRACKS = 100;
