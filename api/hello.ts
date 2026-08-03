import type { VercelRequest, VercelResponse } from '@vercel/node';

// Cross-directory import of `shared/` by RELATIVE path -- never via the `@/`
// alias. Vercel's Node runtime does not support tsconfig path mappings, so an
// aliased import here would type-check locally and then fail to resolve at
// deploy time. Phase 2's /api/playlist and /api/year must copy this shape.
import { MAX_EMBED_TRACKS } from '../shared/constants';

/**
 * Hello-world function. It exists purely to establish, before Phase 2 depends on
 * any of it: the default-export handler signature, the `@vercel/node` request and
 * response types, the relative `shared/` import, and this file's membership in
 * `tsconfig.api.json`. It has no behaviour worth testing.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    message: 'custom-hitster api is alive',
    // Echoed back to prove the shared constant genuinely resolved and bundled
    // from the Node side, rather than merely type-checking.
    maxEmbedTracks: MAX_EMBED_TRACKS,
  });
}
