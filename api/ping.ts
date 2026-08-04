import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * THROWAWAY DIAGNOSTIC -- delete once `/api/hello`'s 500 is understood (see
 * docs/agent_findings.md, 2026-08-04).
 *
 * Isolates ONE variable: does any function run at all? This file has NO runtime
 * imports whatsoever -- the `@vercel/node` import above is type-only and erases to
 * nothing -- so if this returns 200 while `/api/hello` returns 500, the difference is
 * `hello.ts`'s cross-directory `shared/` import and nothing else. If this ALSO 500s,
 * the problem is the runtime or the builder and has nothing to do with imports.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: true, probe: 'ping', imports: 'none' });
}
