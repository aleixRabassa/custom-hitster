import type { VercelRequest, VercelResponse } from '@vercel/node';

// Cross-directory import of `shared/` by RELATIVE path -- never via the `@/`
// alias. Vercel's Node runtime does not support tsconfig path mappings, so an
// aliased import here would type-check locally and then fail to resolve at
// deploy time. Phase 2's /api/playlist and /api/year must copy this shape.
//
// The `.js` EXTENSION IS LOAD-BEARING and must not be "cleaned up". `package.json`
// declares `"type": "module"`, so the deployed function is ESM, and Node's ESM
// resolver -- unlike CommonJS -- does not guess extensions. Vercel transpiles this
// file rather than bundling it, so the specifier reaches Node verbatim: without the
// extension the import throws ERR_MODULE_NOT_FOUND and the function returns
// FUNCTION_INVOCATION_FAILED, after a build that logs no error at all. Measured on a
// real deploy 2026-08-04 (docs/agent_findings.md); every local check passes either
// way. TypeScript resolves the `.js` specifier back to `constants.ts`, and so does
// Vite, so the same form works in the browser build and under Vitest.
import { MAX_EMBED_TRACKS } from '../shared/constants.js';

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
