// Google Play screenshots, captured from the DEPLOYED app with Playwright.
//
// Run it from a scratch directory, never from the repo -- Playwright is deliberately NOT a
// devDependency (pnpm-only rule; the same out-of-lockfile precedent as @bubblewrap/cli):
//
//   mkdir shots && cd shots && npm init -y && npm i playwright@1.63 && npx playwright install chromium
//   node <repo>/visual-assets/screenshots.mjs <out-dir>
//
// Where the output goes: the tablet-7in, tablet-10in and chromebook folders are final but NOT
// committed -- visual-assets/assets/play-tablet-chromebook/ is in .gitignore, so re-run this
// script to regenerate them before an upload. The phone folder is an INTERMEDIATE -- its
// 01/02/03/05 shots are uploaded to Canva and framed under a headline, and only those framed
// exports (visual-assets/assets/play-phone/) are committed. Keep the raw phone shots out of the repo.
//
// Output is JPEG on purpose: Play accepts JPEG or 24-bit PNG with NO alpha, and Playwright's
// PNGs are RGBA. Every size sits inside Play's 320..3840 px and 2:1 limits.
//
// Two content rules, both from visual-assets/listing.md §1 (the trademark rule):
//  - The game shots default to "Rock Party". Until 2026-09-24 the HUD rendered "Jitster official"'s
//    REAL Spotify title, "Hitser" -- one letter from the mark; `src/game/playlist-display-name.ts`
//    fixes that, so PLAYLIST_LABEL="Jitster official" is safe against a deploy that includes it.
//  - Reveal shots skip cards whose title carries an edition suffix ("- 2012 Remaster") or whose
//    year is "Unconfirmed", so a screenshot never advertises a low-confidence answer.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const ORIGIN = 'https://playlistjitster.vercel.app/';
const PLAYLIST = process.env.PLAYLIST_LABEL ?? 'Rock Party';
const OUT = process.argv[2] ?? 'out';

// CSS viewport x deviceScaleFactor = output pixels
const DEVICES = [
  { name: 'phone', width: 412, height: 732, scale: 2.625, mobile: true }, // 1082x1922
  { name: 'tablet-7in', width: 600, height: 960, scale: 2, mobile: true }, // 1200x1920
  { name: 'tablet-10in', width: 800, height: 1280, scale: 2, mobile: true }, // 1600x2560
  { name: 'chromebook', width: 1280, height: 720, scale: 1.5, mobile: false }, // 1920x1080
];

const shot = (page, path, fullPage = false) =>
  page.screenshot({ path: `${path}.jpg`, type: 'jpeg', quality: 95, fullPage });

const browser = await chromium.launch();
for (const d of DEVICES) {
  const dir = `${OUT}/${d.name}`;
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.scale,
    isMobile: d.mobile,
    hasTouch: d.mobile,
    colorScheme: 'dark',
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot(page, `${dir}/01-welcome`);

  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.waitForTimeout(600);
  await shot(page, `${dir}/02-picker`);

  await page
    .getByRole('button', { name: new RegExp(PLAYLIST) })
    .first()
    .click();
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500); // QR render + settle
  const dismiss = page.getByRole('button', { name: 'Dismiss notice' });
  while (await dismiss.count()) {
    await dismiss.first().click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500);
  await shot(page, `${dir}/03-card`);

  let reveals = 0;
  for (let i = 0; i < 30 && reveals < 2; i++) {
    await page.keyboard.press(' ');
    await page.waitForTimeout(1500);
    const text = (await page.locator('[role="status"]').allInnerTexts()).join(' ');
    const clean = !/ - |remaster|\(|version|edit|unconfirmed/i.test(text);
    if (clean && /\b(19|20)\d{2}\b/.test(text)) {
      reveals++;
      await shot(page, `${dir}/0${3 + reveals}-reveal`);
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1500);
  }

  await page.getByRole('button', { name: 'Keep this deck', exact: true }).click();
  await page.waitForTimeout(1000);
  await shot(page, `${dir}/06-deck-actions`);

  await ctx.close();
  console.log('done', d.name);
}
await browser.close();
