/**
 * THROWAWAY PROBE -- delete this file as soon as the deploy below has answered its
 * question. It exists to settle one thing that no local check can:
 *
 *   Does Vercel exclude `_`-prefixed paths under `api/` from function routing?
 *
 * The whole `api/_lib/` convention (plan.phase-2-playlist.md decisions 3 and 3a)
 * rests on the answer being yes. `pnpm typecheck`, `lint`, `test` and `build` all
 * pass either way, because none of them know what Vercel's router does -- so the
 * only way to find out is a real deploy. This repo has already been bitten twice
 * by exactly this class of failure (the solution-file `tsconfig.json` and the
 * path-mapping limitation), both of which passed every local check and failed at
 * deploy time.
 *
 * Deliberately shaped to be the WORST case: a NAMED export and NO default export.
 * If Vercel treats this file as a serverless function it has no handler to call,
 * which is the loud failure we want rather than a silent 200.
 *
 * What to confirm on the deploy:
 *   1. The function build SUCCEEDED (a routed helper without a default export is
 *      the failure mode -- either a build error or a 500 at request time).
 *   2. `/api/_lib/_probe` returns 404, not 200 and not 500.
 *
 * Then: delete this file and record the result, dated, in docs/agent_findings.md.
 * If it IS routed, the documented fallback is to move these helpers to a
 * root-level `server/` tree and add it to `tsconfig.api.json`'s `include`.
 */
export function probeMarker(): string {
  return 'api/_lib routing probe -- delete me';
}
