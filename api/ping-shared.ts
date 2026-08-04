import type { VercelRequest, VercelResponse } from '@vercel/node';

// The ONE difference from `api/hello.ts`: this specifier carries an explicit `.js`
// extension. Same source file, same relative path, same symbol.
//
// Why that might matter: `package.json` declares `"type": "module"`, so the deployed
// function is ESM, and Node's ESM resolver -- unlike CommonJS -- does NOT add
// extensions. If Vercel transpiles `api/hello.ts` without bundling it, the emitted
// import stays extensionless and Node throws ERR_MODULE_NOT_FOUND at import time,
// which surfaces exactly as FUNCTION_INVOCATION_FAILED with a build that looks clean.
// TypeScript resolves a `.js` specifier to the `.ts` source, so this still typechecks.
import { MAX_EMBED_TRACKS } from '../shared/constants.js';

/**
 * THROWAWAY DIAGNOSTIC -- delete once `/api/hello`'s 500 is understood (see
 * docs/agent_findings.md, 2026-08-04).
 *
 * Isolates the second variable: whether a cross-directory `shared/` import works when
 * the specifier is ESM-correct. Read together with `api/ping.ts` and `api/hello.ts`,
 * the three responses form a truth table that names the cause without guessing.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: true, probe: 'ping-shared', maxEmbedTracks: MAX_EMBED_TRACKS });
}
