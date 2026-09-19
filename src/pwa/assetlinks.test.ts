/**
 * A `node` test — this repo's default environment (`toolchain.md` §5). It reads three files
 * from disk as text and parses two of them; there is no DOM, no build and no Android
 * toolchain involved, and there is deliberately no per-file environment docblock. (As in
 * `src/pwa/manifest.test.ts` and `src/index.css.test.ts`, this header refers to that tag
 * descriptively and never writes it out: Vitest scans a file's leading comment for it and
 * does not care whether what it finds is a directive or a sentence about one.)
 *
 * ===========================================================================
 *  WHAT THIS FILE IS FOR, AND WHAT IT CANNOT DO.
 *
 *  `public/.well-known/assetlinks.json` is the Digital Asset Links statement
 *  that tells Android the installed TWA and this origin are the same party.
 *  When it is right, the app opens with no URL bar. When it is wrong, the app
 *  still installs, still launches and still works -- with a browser address
 *  bar pinned across the top of every screen, which is the entire difference
 *  between a store app and a bookmark.
 *
 *  This file CANNOT tell you the link is verified. Verification is performed
 *  by the Android system, at install time, against the file fetched over
 *  HTTPS from the production origin, using the signing certificate Google
 *  Play actually used. Nothing in this repo can stand in for any of that: the
 *  real checks are manual, on a device, and are steps 9 and 12 of
 *  `docs/plans/plan.google-play-shell.md`.
 *
 *  What it CAN do is pin the file's SHAPE and its REACHABILITY, which are the
 *  two halves that fail silently here rather than on the device. A malformed
 *  statement list, a namespace typo or a package id that drifted from the one
 *  the shell was built with all produce a green build and a URL bar; and so
 *  does a rewrite rule that hands `/.well-known/assetlinks.json` back as
 *  `index.html` with a 200, which is the failure mode that looks most like
 *  success.
 *
 *  TWO TESTS ARE DELIBERATELY ABSENT, AND THEIR ABSENCE IS THE DESIGN.
 *  `should list two colon-separated SHA-256 fingerprints` and
 *  `should agree with android/twa-manifest.json about the package id` belong
 *  to STEP 12 of the plan, not to step 4. Today the fingerprint list is
 *  empty on purpose -- no keystore exists yet, and the upload key and the
 *  Play app-signing key are both generated later -- and `android/` does not
 *  exist at all. Written now, both would be red for eight steps, and a test
 *  that is red for eight steps is a test people learn to skip rather than
 *  trust. Add them when the fingerprints land, not before.
 * ===========================================================================
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/**
 * The application id, DECIDED 2026-09-19 and permanent after the first publish to Google
 * Play. It is duplicated here rather than imported because there is nothing to import from:
 * this test's whole job is to be the second copy that notices if the first one moves.
 */
const PACKAGE_ID = 'aleixrabassa.playlistjitster';

/**
 * The shape the statement list is asserted against. `JSON.parse` returns `any`, so the
 * parsed value is taken as `unknown` and narrowed through this -- otherwise every
 * assertion below reads a property off `any` and a structural mistake in the file would
 * surface as `undefined === undefined` rather than as a failure.
 */
interface AssetLinkStatement {
  relation?: unknown;
  target?: {
    namespace?: unknown;
    package_name?: unknown;
    sha256_cert_fingerprints?: unknown;
  };
}

function readStatements(): AssetLinkStatement[] {
  const raw = readFileSync(join(repoRoot, 'public', '.well-known', 'assetlinks.json'), 'utf8');
  const parsed: unknown = JSON.parse(raw);

  // The top level of a Digital Asset Links file is a LIST of statements, not a statement.
  // An object here is valid JSON that Android rejects outright, and nothing in the build
  // reads this file at all -- so this is the only place that would ever say so.
  expect(Array.isArray(parsed)).toBe(true);

  return parsed as AssetLinkStatement[];
}

describe('the digital asset links statement', () => {
  it('should be valid JSON containing exactly one delegate_permission statement', () => {
    const statements = readStatements();

    // Exactly one. A second statement is how a copy-paste from another app's file survives
    // review: the file stays valid, Android happily verifies the OTHER package as well, and
    // this origin has silently delegated URL handling to something nobody meant to trust.
    expect(statements).toHaveLength(1);

    // The relation is asserted as the whole array rather than with `toContain`, because
    // `common.handle_all_urls` is the only relation that suppresses the URL bar. A file
    // carrying `common.get_login_creds` instead parses, verifies, and does nothing useful.
    expect(statements[0]?.relation).toEqual(['delegate_permission/common.handle_all_urls']);
  });

  it('should target the android_app namespace and the committed package id', () => {
    const target = readStatements()[0]?.target;

    // `web` is the other namespace this field takes, and it is what a statement copied from
    // a site-to-site delegation example carries. It parses; it just never matches an app.
    expect(target?.namespace).toBe('android_app');

    // ===================================================================
    //  THE ONE STRING IN THIS PLAN THAT CANNOT BE CHANGED LATER.
    //
    //  The application id is permanent after the first publish, and it is
    //  written down in two places that cannot derive from each other: here,
    //  and (from step 6) `android/twa-manifest.json`. A mismatch between
    //  them fails ONLY on a device, ONLY after an install, and looks exactly
    //  like an app that works -- with an address bar.
    //
    //  This half of the pin exists now; the cross-file half is the step-12
    //  test named in this file's header.
    // ===================================================================
    expect(target?.package_name).toBe(PACKAGE_ID);

    // The fingerprint list is EMPTY ON PURPOSE until step 12, so its LENGTH is not asserted
    // here -- that is the step-12 test. What is asserted is that the key is present and is
    // an array: Android rejects a statement missing the field, and the empty-array
    // placeholder is what makes step 12 a value change rather than a structural one.
    expect(Array.isArray(target?.sha256_cert_fingerprints)).toBe(true);
  });

  it('should ship a non-empty privacy policy page', () => {
    // Cheap insurance against a store listing that links to a 404. The Play Console demands
    // a privacy policy URL, checks only that it resolves at submission time, and a policy
    // page deleted or renamed afterwards is a compliance failure nobody local would notice.
    const policy = join(repoRoot, 'public', 'privacy.html');

    expect(existsSync(policy)).toBe(true);

    // Non-empty, because an empty file is served with a 200 and satisfies any check that
    // only looks at the status code -- including the reviewer's.
    expect(readFileSync(policy, 'utf8').trim().length).toBeGreaterThan(0);
  });

  it('should keep the SPA rewrite away from the well-known path and the policy', () => {
    // ===================================================================
    //  ONE CHARACTER CLASS HOLDS UP THREE THINGS, AND `vercel.json`
    //  CANNOT CARRY A COMMENT SAYING SO.
    //
    //  The single rewrite sends everything that is not an `api/` route to
    //  `/index.html` so the SPA can route it. `[^.]*` is what excludes any
    //  path containing a dot -- which is the only reason
    //  `/.well-known/assetlinks.json`, `/privacy.html` and the welcome
    //  screen's `/year-cards-1970-2033.pdf` are served as themselves.
    //
    //  Widen it to `.*` and nothing here fails: the build is green, the app
    //  works, and the asset-links file comes back as `index.html` WITH A
    //  200. Android's verifier reads a page of HTML where it expected a
    //  statement list, declines the link, and the installed app grows an
    //  address bar -- the most expensive silent failure in this plan.
    //
    //  A STRING ASSERTION IS THE HONEST CEILING, and that is deliberate
    //  rather than lazy. Proving the rewrite does not match a given URL
    //  would mean re-implementing path-to-regexp's semantics in a test, and
    //  a re-implementation that disagreed with Vercel's would be worse than
    //  no test at all. The deployed behaviour is checked by fetching the
    //  file from the production origin -- step 4's last sub-bullet, manual.
    // ===================================================================
    const raw = readFileSync(join(repoRoot, 'vercel.json'), 'utf8');
    const config: unknown = JSON.parse(raw);

    const rewrites = (config as { rewrites?: { source?: unknown }[] }).rewrites ?? [];

    // "Its ONE rewrite". A second rule added above this one could match the well-known path
    // first, and the assertion below would still pass while describing the wrong rule.
    expect(rewrites).toHaveLength(1);

    const source = rewrites[0]?.source;
    expect(typeof source).toBe('string');
    expect(source as string).toContain('[^.]*');
  });
});
