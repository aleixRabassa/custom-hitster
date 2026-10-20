/**
 * Vercel's `ignoreCommand` (vercel.json): exit 0 SKIPS the deployment, exit 1 builds.
 *
 * It skips only when every commit since the last successful deployment touched documentation
 * alone (`docs/` and `*.md`), so a docs-only push never wipes the per-deployment CDN cache of
 * `/api/year`. Any doubt builds: no `VERCEL_GIT_PREVIOUS_SHA` (a branch's first deploy), a SHA
 * missing from Vercel's shallow `--depth=10` clone, or any git error.
 *
 * It diffs against the previous DEPLOYMENT, never `HEAD^`: a push of a code commit followed by a
 * docs commit must still build.
 *
 * A Node script and not the shell one-liner it replaced (2026-10-20): `ignoreCommand` is capped at
 * 256 characters by the vercel.json schema, and the 304-character one-liner failed every deployment
 * at configuration validation. Not a `.sh` file either: this checkout is CRLF, and a committed
 * script could reach Linux `sh` with `\r` line endings.
 */
import { execFileSync } from 'node:child_process';

const previous = process.env.VERCEL_GIT_PREVIOUS_SHA ?? '';

/** True when git exits 0. `execFileSync` throws on any other exit, so a failure reads as false. */
function gitSucceeds(args) {
  try {
    execFileSync('git', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const onlyDocsChanged =
  previous !== '' &&
  gitSucceeds(['cat-file', '-e', `${previous}^{commit}`]) &&
  // `--quiet` exits 0 when nothing outside the excluded paths changed. No shell, so the pathspecs
  // reach git verbatim.
  gitSucceeds([
    'diff',
    '--quiet',
    previous,
    'HEAD',
    '--',
    '.',
    ':(exclude)docs',
    ':(exclude,glob)**/*.md',
  ]);

if (onlyDocsChanged) {
  console.log('Only docs changed since the last deployment: skipping the build');
  process.exit(0);
}
process.exit(1);
