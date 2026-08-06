<!-- Plans for Phase 8 (in order):
  1. plan.phase-8-look-and-shell.md  — neon-ring card design, contrast re-audit, PWA, icon set  ← this file
  2. plan.phase-8-features.md        — shareable deck URL, saved-playlist library, PDF export, audio across the flip
  3. plan.phase-8-added-by.md        — the "Added by" decision. No code.
-->

# Plan: Phase 8 (first of three) — The Card's Look, and the Installable Shell

> **Phase:** 8 — Nice-to-haves (`plan.md` §5)
> **Date:** 2026-08-06
> **Author:** Aleix Rabassa
> **Depends on:** nothing. This is the first plan of the set and it produces the icon set and the
> token values the other two consume.

---

## Overview

Two of Phase 8's items, and they share a surface. The **card visual design** is the phase's headline
— `plan.md` §5 lists it as "take cues from the reference repo's neon-ring aesthetic" — and Phase 7
built `src/index.css` specifically so it would be a change of token values rather than a hunt across
nine components. The **PWA** item needs a manifest, an icon set and a service worker, and the icon
set is an asset decision that belongs beside the visual one rather than three weeks after it.

**Two things this plan was originally scoped to do are already done, and it does not redo them.**
`public/logo.png` — 1.26 MB at 1254×1254, downloaded on every visit as the favicon — was replaced
during Phase 7's second half with `public/logo.webp` at 240×240 and 20,610 bytes. That fix alone took
the landing screen from **Performance 75 / LCP 7.8 s to Performance 99 / LCP 1.6 s**, which retired
the prerendering item before it was ever planned: the diagnosis that "LCP is gated on React mounting"
was wrong, and the favicon had simply been saturating the throttled link. So there is **no static
shell and no prerender toolchain in this plan.** What replaces that work is a much smaller obligation
— a Lighthouse **re-measure after the redesign**, because a glow-heavy card is exactly the kind of
change that gives back a 99 without anyone noticing.

The redesign also invalidates something. Phase 7 computed four WCAG 1.4.3 corrections against the
current `oklch` values and recorded the ratios in `agent_findings.md`. A new palette makes that table
describe a build that no longer exists, so **a measured contrast re-audit is a step here, not a
follow-up.** The trap it guards is specific and has already shipped once in this repo: an unknown
Tailwind colour utility emits **no rule at all**, silently, with all four checks green.

Finally this plan carries one piece of Phase 7 debt that belongs with a visual change: the
**screen-reader pass over one flip**. It is the only check on `CardRevealSide`'s live region — the
single most valuable change Phase 7 made — and the card is about to be rebuilt around it.

---

## Dependency Contract

### Produces for downstream plans

| Output                                                | Consumed by                                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The new `@theme static` values and the ring utilities | `plan.phase-8-features.md` — the PDF export consumes the token names, **not** necessarily the values; see that plan's print-palette decision                    |
| The generated icon set and its source-asset provenance | Nothing downstream, but it is the answer to "where did these PNGs come from" that the deleted 1.26 MB source would otherwise take a `git log` to reconstruct    |
| A post-redesign Lighthouse baseline                    | `plan.phase-8-features.md` — the PDF library is a new dependency and its chunk needs to be measured against a number that reflects the redesign, not Phase 7's |

---

## Scope & Affected Areas

| Area                                    | Type     | Notes                                                                                                                  |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/index.css`                         | Modified | The whole of this plan's visual half: new tokens, the ring utilities, a possible fourth reduced-motion rule             |
| `src/index.css.test.ts`                 | Modified | The canary extends to the new tokens and utilities                                                                      |
| `src/components/Card.tsx`               | Modified | Consumes the ring utility; any literal border or radius it still carries moves to a token                               |
| `src/components/CardHiddenSide.tsx`     | Modified | Face treatment; the QR's surround is the one place contrast is about scannability rather than reading                   |
| `src/components/CardRevealSide.tsx`     | Modified | Face treatment; the year is the largest thing in the app and the redesign must not reduce that                          |
| `src/components/CardStack.tsx`          | Modified | The two peeking backs get a dimmer ring variant. They stay **empty divs** — no content, no QR, no id                    |
| `src/components/*.test.tsx`             | Modified | Class-name assertions for every new utility, per the silent-no-op rule                                                  |
| `index.html`                            | Modified | `theme-color` by hand if `--color-page` moves; the icon links; the manifest link if not injected                        |
| `public/`                               | New      | The generated PWA icon set (192, 512, 512-maskable, 180 apple-touch). `logo.webp` stays as the favicon                  |
| `src/pwa/manifest.ts` (or similar)      | New      | The manifest as a plain typed module so it is unit-testable, imported by `vite.config.ts`                               |
| `src/pwa/manifest.test.ts`              | New      | Node environment. Asserts the fields an installability check actually requires                                          |
| `vite.config.ts`                        | Modified | `vite-plugin-pwa` registered, workbox options, `devOptions` left off                                                    |
| `package.json`                          | Modified | `vite-plugin-pwa` as a **devDependency**                                                                                |
| `vercel.json`                           | Review   | The SPA rewrite already excludes paths containing a dot, so `/sw.js` and `/manifest.webmanifest` serve as files — verify, do not assume |
| `docs/architecture.md`                  | Modified | §3 — the ring utilities, the icon set, the service worker's position and what it deliberately does not cache            |
| `docs/development.md`                   | Modified | §5 new manual rows, §8 known limitations                                                                                |
| `docs/agent_findings.md`                | Modified | The re-audited contrast table, the icon provenance, and whatever the PWA work turns up                                  |
| `docs/plans/plan.md`                    | Modified | §5 — tick the card-design and PWA boxes, record the reversal of the prerender assumption                                |
| `AGENTS.md`                             | Modified | Current-phase line; the service worker as a new structural fact                                                         |
| `README.md`                             | Modified | That the app is installable, and the update behaviour a user will see                                                   |

---

## Chosen Approach

**The neon ring is tokens plus one or two `@utility` composites, and no new component.** Phase 7's
`@theme static` block already names every colour, dimension and duration in the app; the redesign
adds ring and glow tokens beside them and expresses the ring itself as a composite utility — layered
box-shadows for the crisp inner edge and the outer bloom, with a `::before` pseudo-element if a
gradient border is wanted. Applying it is then a class on `Card`'s outer element and a dimmer variant
on `CardStack`'s backs.

Chosen over a dedicated `NeonRing`/`CardFrame` component because that buys expressive range this
design does not need and costs three things it would rather not pay: a component and its tests, a new
`aria-hidden` decorative node inside the one subtree where "leak nothing" is a hard rule, and a fourth
animation surface that `prefers-reduced-motion` would have to be taught about in a second place. It
was also chosen over a values-only recolour, which is the cheapest option and delivers no ring at all
— and the ring is the actual ask.

**The PWA is `vite-plugin-pwa` in `generateSW` mode, precaching the build output and nothing else.**
No runtime caching of `/api/playlist` or `/api/year`: a cached playlist response can deal a deck that
no longer matches the real playlist, and the year cache's own freshness story does not extend to a
copy sitting in a browser. Offline therefore means the shell loads and a **resumed session stays
playable** minus audio and further lookups — which composes with work that already exists rather than
adding to it, because Phase 7's `offline` error code already refuses a Start that cannot succeed and
says so in its own sentence.

**The update strategy is the waiting default, not `autoUpdate`.** This app code-splits `GameScreen`
and `qrcode` behind dynamic imports. A service worker that calls `skipWaiting` and activates mid-game
after a redeploy leaves a running tab asking for a chunk hash that no longer exists — a hard failure
at exactly the moment a player advances a card. Letting the new worker wait until every tab is closed
costs a delayed update and buys a session that cannot break underneath itself.

**The manifest lives in a typed TS module, not inline in `vite.config.ts`.** Same reasoning as the
decision/binding split elsewhere in the repo: the fields an installability check requires are a fact
worth asserting in a node test, and a literal buried in a plugin call cannot be imported.

---

## Implementation Steps

- [ ] **1. Write the target palette down before touching CSS.** A table of every token that changes,
      its current value and its intended one. Doing this first is what makes step 6 an audit rather
      than a rediscovery.
  - [ ] Decide whether `--color-page` and `--color-surface` move at all. Staying near-black is the
        conservative answer and has three independent reasons: the existing contrast table survives
        largely intact, an OLED phone is the target device, and a neon ring reads as neon only
        against something dark.
  - [ ] Decide the ring's hue relationship to `--color-accent`. One accent family is a design
        choice; two is a decision that needs stating.
- [ ] **2. Add the ring and glow tokens to `@theme static`.** Ring width, ring colour, glow colour,
      glow blur, glow spread, and the dimmed variants the stack's backs need. `static`, as the whole
      block already is — a bare `@theme` would tree-shake any token only an `@utility` references,
      which is precisely what these are.
- [ ] **3. Add the ring utilities to `src/index.css`.** One for the live card, one dimmer variant for
      the backs. Both composed from step 2's tokens, no literals.
  - [ ] If a gradient border is used, keep it in the utility's own `::before` rather than adding a
        node to the card's DOM.
- [ ] **4. Apply the utilities and remove the literals they replace.** `Card`, `CardHiddenSide`,
      `CardRevealSide`, `CardStack`. Every border, radius or shadow still written inline in those
      files either becomes a token or is deleted.
  - [ ] `CardStack`'s backs stay **empty divs** — no content, no QR, no id. The dimmer ring is a
        class on an empty element, and it must not become a reason to render anything inside one.
  - [ ] Nothing interactive goes inside `Card`. Two existing tests assert this; do not weaken them.
- [ ] **5. Decide whether the ring animates, and record the answer either way.**
  - [ ] If it does: add a fourth `data-motion` hook, a fourth rule in the `prefers-reduced-motion`
        block, and a line in the canary test. Four surfaces, still two declarations plus one.
  - [ ] If it does not: say so in the CSS comment, because "why is the ring the only static thing"
        is otherwise a question the next session re-answers from scratch.
- [ ] **6. Re-audit contrast against the new values, computed and not eyeballed.** Every
      foreground/background pair in the app, not only the ones that changed — a new surface value
      moves ratios for text that was never touched.
  - [ ] WCAG 1.4.3 for text: 4.5:1 normal, 3:1 large. The year, the muted lines, the placeholder,
        the disabled controls and the on-accent and on-danger labels are the pairs Phase 7 found
        problems in and are the ones most likely to break again.
  - [ ] WCAG 1.4.11 for non-text: the focus ring against every surface it can land on, at 3:1. If
        the ring itself ever conveys state rather than decoration, it joins this list.
  - [ ] `--color-fg-decorative` is deliberately failing at 1.94:1 today because it is `aria-hidden`
        decoration. Re-confirm that exemption still holds under the new palette or fix it.
  - [ ] Replace the table in `agent_findings.md` rather than appending a second one. Two contrast
        tables describing different builds is worse than one.
- [ ] **7. Update `theme-color` in `index.html` by hand if `--color-page` moved.** A `meta` content
      attribute cannot hold a `var()`, so this is the one duplicated colour in the app and the file's
      own comment says it must be updated by hand. Getting it wrong puts a mismatched bar above the
      app on every phone.
- [ ] **8. Grep the built CSS for every new utility.** Build, then search `dist/assets/*.css` for
      each new class and each new custom property. This is not belt and braces: an unknown Tailwind
      colour utility is a **silent no-op** and all four local checks pass either way. It has shipped
      once in this repo, and the symptom was near-black text on a near-black card.
- [ ] **9. Add `vite-plugin-pwa` as a devDependency and register it in `vite.config.ts`.** pnpm only.
      `devOptions` stays off, so neither `pnpm dev` nor `npx vercel dev` starts serving a worker —
      a service worker in development is a caching bug generator, and this repo's dev story is
      already delicate enough.
- [ ] **10. Generate the icon set.** 192×192, 512×512, a 512×512 **maskable** variant, and a 180×180
      apple-touch-icon. PNG, because manifest icon support for WebP is not universal and iOS ignores
      the manifest's icons entirely in favour of the apple-touch link.
  - [ ] Recover the original 1254×1254 source from git history rather than upscaling `logo.webp`.
        Record the commit it came from in `agent_findings.md`.
  - [ ] **Do not re-add a large PNG to `public/`.** The favicon stays `logo.webp`. Each generated
        icon is only as large as its own dimensions require, and the total added weight goes in the
        findings entry — the 1.26 MB lesson is two weeks old.
  - [ ] The maskable variant needs its own safe-zone padding. A maskable icon that is just the 512
        renamed gets its edges cropped on Android.
- [ ] **11. Write the manifest as a typed module and import it into the plugin config.** Name,
      short name, description, `start_url`, `display: standalone`, `background_color`, `theme_color`
      matching `--color-page` after step 1, the icon set, and an orientation decision.
  - [ ] `theme_color` here and the `meta` tag in `index.html` are now a **third** copy of the page
        colour. Note it beside the existing warning, or derive both from one place.
- [ ] **12. Configure workbox to precache the build output and nothing else.**
  - [ ] A navigation-fallback denylist covering `^/api/`, so the shell is never served in place of
        a function response.
  - [ ] No runtime caching rule for `/api/playlist` or `/api/year`. This is a decision, not an
        omission — write it in the config comment.
  - [ ] Confirm the code-split chunks (`GameScreen`, the `qrcode` chunk) are in the precache
        manifest. They are hashed build output, so they should be, but a chunk that is fetched
        lazily and precached eagerly is worth verifying rather than assuming.
- [ ] **13. Keep the waiting update strategy and verify what a user sees.** Deploy, load, deploy
      again, reload. The old worker should keep serving until the tab closes. Confirm that a
      mid-game reload does not produce a missing-chunk error.
- [ ] **14. Verify the offline story end to end, and change nothing if it already works.** With the
      app installed and the network off: the shell loads; a saved session resumes and is playable
      without audio; pressing Start produces Phase 7's `offline` copy rather than a hung request.
      If all three hold, this step writes documentation and no code.
- [ ] **15. Re-run Lighthouse on the landing screen, production build, all four categories.** The
      number to protect is **Performance 99**; the number to watch is CLS, because a glow that
      paints late is a layout-stable change and a ring that resizes the card is not. Record the
      scores beside Phase 7's so the comparison is one table.
  - [ ] Accessibility 100 is a floor and not a result — it is an automated pass over a static
        screen. Do not let it stand in for step 16.
- [ ] **16. Run the screen-reader pass over one flip.** Phase 7 debt, and the one it names as most
      valuable. Flip a card with a screen reader running and confirm `CardRevealSide`'s polite live
      region announces the year. Confirm the hidden face announces nothing about the track.
  - [ ] Record the reader and platform used. "It worked" without naming NVDA or VoiceOver is not a
        result anyone can build on.
- [ ] **17. Three widths and the reduced-motion pass, if the redesign touched either.** A ring with
      a glow changes what reduced motion has to suppress, and a fluid card with a new border width
      changes what the clamp resolves to. Both are Phase 7 rows in `development.md` §5 that this
      plan can either discharge or leave Pending — but not silently invalidate.

---

## Unit Tests

- [ ] `should name every new ring and glow token` — the `@theme static` block, in
      `src/index.css.test.ts`. Text-level canary, same as the existing block, and labelled as one.
- [ ] `should define the ring utility and its dimmed variant` — `src/index.css.test.ts`.
- [ ] `should name the ring in the reduced-motion block` — `src/index.css.test.ts`, **only if step 5
      decides the ring animates.** A test asserting a rule that should not exist is worse than none.
- [ ] `should apply the ring utility to the card` — `src/components/Card.test.tsx`, a class-name
      assertion. This is the silent-no-op guard, and `CardHiddenSide.test.tsx` already has one to
      copy the shape from.
- [ ] `should apply the dimmed ring variant to each back` — `src/components/CardStack.test.tsx`.
- [ ] `should render each back with no content, no QR and no id` — `src/components/CardStack.test.tsx`.
      Exists; re-run rather than rewrite, and do not let the ring class become an excuse to relax it.
- [ ] `should render no live region on the hidden face` — `src/components/CardHiddenSide.test.tsx`.
      Exists. It is the assertion the redesign is most likely to break by accident.
- [ ] `should declare the fields an installability check requires` — `src/pwa/manifest.test.ts`,
      node environment. Name, short name, `start_url`, `display`, and at least a 192 and a 512 icon.
- [ ] `should declare a maskable icon with its own purpose` — `src/pwa/manifest.test.ts`.
- [ ] `should point theme_color at the same value as the page token` — `src/pwa/manifest.test.ts`.
      The manifest is now the third copy of that colour; this is the only one a test can hold.

---

## Documentation Updates

- [ ] `docs/architecture.md` §3 — the ring utilities and why they are utilities rather than a
      component; the icon set and where its source came from; the service worker's position, its
      precache scope, and the two things it deliberately does not cache.
- [ ] `docs/development.md` §5 — new manual rows: the installability check, the offline resume, the
      update-on-redeploy check, and the post-redesign Lighthouse re-measure. Mark the screen-reader
      row Done with the reader named, or leave it Pending and say so.
- [ ] `docs/development.md` §8 — what offline does and does not cover, and the waiting-update delay
      as a deliberate limitation rather than a bug.
- [ ] `docs/agent_findings.md` — the re-audited contrast table replacing Phase 7's; the icon
      provenance and total added bytes; the post-redesign Lighthouse scores; anything the PWA work
      turns up. Date every entry, and tell the developer they were added.
- [ ] `docs/plans/plan.md` §5 — tick the card-design and PWA boxes; add a Phase 8 completion note in
      the style of Phases 3–7; record explicitly that the prerendering item was **retired by the
      favicon fix** rather than built, because "LCP is gated on React mounting" is a conclusion that
      will be re-reached by the next person who reads Performance 75 in an old note.
- [ ] `AGENTS.md` — current-phase line; the service worker as a structural fact, including that it
      does not cache the API and that development never registers one.
- [ ] `README.md` — that the app is installable, what offline covers, and that an update lands after
      every tab is closed.
- [ ] `index.html` — the icon links, and the `theme-color` comment updated if the value moved.
      Comments here are shipped bytes: keep the reasoning in `architecture.md` and the constraint
      in the file.

---

## Testing Strategy

- **Unit tests:** the canary over `index.css`, class-name assertions at every new utility's call
  site, and the manifest module in the node environment. That is the whole of what is automatable —
  see the limitation below.
- **Integration tests:** none new. The card's composition is already covered by the existing
  component tests, and the redesign should not change what they assert.
- **Manual verification:** the load-bearing half of this plan, and it is not a shortfall of effort.
  jsdom evaluates no media queries, has no `window.matchMedia`, computes no layout and has no
  accessibility-tree consumer, so a class-name assertion is the ceiling for anything visual.
  - Lighthouse on a production build under `pnpm preview`, all four categories, compared against
    Phase 7's Performance 99 / LCP 1.6 s.
  - Install the app on a real phone; check the icon, the splash and the maskable crop.
  - Airplane mode: shell loads, saved session resumes, Start says `offline`.
  - Redeploy and reload with a game in progress; confirm no missing-chunk failure.
  - One flip with a screen reader, reader and platform recorded.
  - The card at three widths, and once with the OS reduced-motion preference set.

---

## Assumptions & Decisions

| #  | Assumption / Decision                                                                                   | Rationale                                                                                                                                                                     |
| -- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | The ring is tokens plus `@utility` composites; no new component                                          | Chosen over a `NeonRing` component and over a values-only recolour. Avoids a decorative node inside the leak-critical subtree and a second place to teach reduced motion       |
| 2  | Prerendering is **not** in this plan                                                                     | Already retired. The favicon fix took the landing screen from Performance 75 / LCP 7.8 s to 99 / 1.6 s with no code touched                                                    |
| 3  | The logo/asset item is **already discharged**                                                            | `public/logo.png` is gone; `public/logo.webp` is 240×240 and 20,610 bytes. What remains is the PWA icon set, which is a different asset for a different purpose                |
| 4  | Contrast is re-audited as a step, not as a follow-up                                                     | A new palette makes Phase 7's measured table describe a build that no longer exists, and an unknown colour utility fails silently with all four checks green                   |
| 5  | The service worker precaches build output only — no API runtime caching                                  | A cached playlist response can deal a deck that no longer matches the real playlist. Offline is worth having; a wrong deck is not                                              |
| 6  | The update strategy waits rather than `skipWaiting`                                                      | `GameScreen` and `qrcode` are lazy chunks. An activation mid-game after a redeploy makes the next card a missing-chunk error                                                   |
| 7  | The manifest is a typed module imported by `vite.config.ts`                                              | Makes the installability-critical fields assertable in a node test. A literal inside a plugin call cannot be imported                                                          |
| 8  | Icons are PNG, generated from the pre-deletion source in git history                                     | Manifest WebP support is not universal and iOS ignores manifest icons entirely; upscaling the 240px WebP would produce a soft 512                                              |
| 9  | The screen-reader pass rides with this plan                                                              | It is Phase 7's highest-value outstanding check and it covers the component this plan is rebuilding around                                                                     |
| 10 | `--color-page` and `--color-surface` are expected to stay near-black                                     | Preserves most of the contrast table, suits an OLED phone, and is what makes a neon ring read as neon. Step 1 may overturn it, but it is the starting position                 |

---

## Open Questions

- [ ] **Does the ring animate?** A slow pulse or a rotating gradient is the reference aesthetic, and
      it is also a fourth animation surface plus a fourth reduced-motion rule. Step 5 decides;
      recording the answer matters more than which way it goes.
- [ ] **Does the QR's surround change?** A QR scans on contrast and a quiet zone. If the redesign
      puts a glow or a coloured field behind the code, that is the one contrast decision in this plan
      that is about a camera rather than an eye, and it must be tested against a real phone — Phase 4
      already owes a scan check.
- [ ] **Does `--color-page` move, and if so how many places copy it?** Two today: the token and
      `index.html`'s `theme-color`. Three after the manifest. Worth deciding whether one of them can
      derive rather than duplicate.
- [ ] **Orientation lock in the manifest?** The game is a portrait card on a phone but is played on
      laptops too. Locking is a real usability call and not obviously right.

---

## Out of Scope

- **Prerendering, a static HTML shell, or any SSR toolchain.** Retired by the favicon fix; see
  decision 2.
- **Re-optimising `public/logo.webp`.** Done in Phase 7's second half.
- **Runtime caching of `/api/*`.** Decision 5, and reopening it means reopening the year cache's
  freshness story.
- **The shareable deck URL, the saved-playlist library, the PDF export, and the audio-across-flip
  change** — all `plan.phase-8-features.md`.
- **The "Added by" item** — `plan.phase-8-added-by.md`, and it writes no code.
- **The real-device touch pass.** It belongs with the audio behaviour change, in plan 2.
- **The preview-deployment verification of progressive loading** (step 15 of
  `plan.phase-4-6-screens.md`) and the **game-screen Lighthouse audit** Phase 7 added to it. Still
  owed, still needs a deployment with Upstash configured, and this plan does not discharge either.
- **Retuning the five gesture thresholds.** They remain documented guesses, and a second guess is
  not an improvement on the first.
