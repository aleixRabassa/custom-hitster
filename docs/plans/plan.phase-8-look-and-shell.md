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

| Output                                                 | Consumed by                                                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The new `@theme static` values and the ring utilities  | `plan.phase-8-features.md` — the PDF export consumes the token names, **not** necessarily the values; see that plan's print-palette decision                   |
| The generated icon set and its source-asset provenance | Nothing downstream, but it is the answer to "where did these PNGs come from" that the deleted 1.26 MB source would otherwise take a `git log` to reconstruct   |
| A post-redesign Lighthouse baseline                    | `plan.phase-8-features.md` — the PDF library is a new dependency and its chunk needs to be measured against a number that reflects the redesign, not Phase 7's |

---

## Scope & Affected Areas

| Area                                | Type     | Notes                                                                                                                                   |
| ----------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.css`                     | Modified | The whole of this plan's visual half: new tokens, the ring utilities, a possible fourth reduced-motion rule                             |
| `src/index.css.test.ts`             | Modified | The canary extends to the new tokens and utilities                                                                                      |
| `src/components/Card.tsx`           | Modified | Consumes the ring utility; any literal border or radius it still carries moves to a token                                               |
| `src/components/CardHiddenSide.tsx` | Modified | Face treatment; the QR's surround is the one place contrast is about scannability rather than reading                                   |
| `src/components/CardRevealSide.tsx` | Modified | Face treatment; the year is the largest thing in the app and the redesign must not reduce that                                          |
| `src/components/CardStack.tsx`      | Modified | The two peeking backs get a dimmer ring variant. They stay **empty divs** — no content, no QR, no id                                    |
| `src/components/*.test.tsx`         | Modified | Class-name assertions for every new utility, per the silent-no-op rule                                                                  |
| `index.html`                        | Modified | `theme-color` by hand if `--color-page` moves; the icon links; the manifest link if not injected                                        |
| `public/`                           | New      | The generated PWA icon set (192, 512, 512-maskable, 180 apple-touch). `logo.webp` stays as the favicon                                  |
| `src/pwa/manifest.ts` (or similar)  | New      | The manifest as a plain typed module so it is unit-testable, imported by `vite.config.ts`                                               |
| `src/pwa/manifest.test.ts`          | New      | Node environment. Asserts the fields an installability check actually requires                                                          |
| `vite.config.ts`                    | Modified | `vite-plugin-pwa` registered, workbox options, `devOptions` left off                                                                    |
| `package.json`                      | Modified | `vite-plugin-pwa` as a **devDependency**                                                                                                |
| `vercel.json`                       | Review   | The SPA rewrite already excludes paths containing a dot, so `/sw.js` and `/manifest.webmanifest` serve as files — verify, do not assume |
| `docs/architecture.md`              | Modified | §3 — the ring utilities, the icon set, the service worker's position and what it deliberately does not cache                            |
| `docs/development.md`               | Modified | §5 new manual rows, §8 known limitations                                                                                                |
| `docs/agent_findings.md`            | Modified | The re-audited contrast table, the icon provenance, and whatever the PWA work turns up                                                  |
| `docs/plans/plan.md`                | Modified | §5 — tick the card-design and PWA boxes, record the reversal of the prerender assumption                                                |
| `AGENTS.md`                         | Modified | Current-phase line; the service worker as a new structural fact                                                                         |
| `README.md`                         | Modified | That the app is installable, and the update behaviour a user will see                                                                   |

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

- [x] **1. Write the target palette down before touching CSS.** A table of every token that changes,
      its current value and its intended one. Doing this first is what makes step 6 an audit rather
      than a rediscovery. — **Execution note 1.**
  - [x] Decide whether `--color-page` and `--color-surface` move at all. Staying near-black is the
        conservative answer and has three independent reasons: the existing contrast table survives
        largely intact, an OLED phone is the target device, and a neon ring reads as neon only
        against something dark. — **Neither moves, and neither does `--color-surface-raised`.**
  - [x] Decide the ring's hue relationship to `--color-accent`. One accent family is a design
        choice; two is a decision that needs stating. — **Two, stated in note 1: emerald stays the
        action colour, the ring is decoration that never conveys state.**
- [x] **2. Add the ring and glow tokens to `@theme static`.** Ring width, ring colour, glow colour,
      glow blur, glow spread, and the dimmed variants the stack's backs need. `static`, as the whole
      block already is — a bare `@theme` would tree-shake any token only an `@utility` references,
      which is precisely what these are. — **Ten tokens; the `static` hazard is spelled out in the
      block's own header, because these are the first tokens in the app consumed ONLY by an
      `@utility`.**
- [x] **3. Add the ring utilities to `src/index.css`.** One for the live card, one dimmer variant for
      the backs. Both composed from step 2's tokens, no literals. — **`card-ring` and
      `card-ring-dim`. See execution note 3 for the one thing neither of them sets.**
  - [x] If a gradient border is used, keep it in the utility's own `::before` rather than adding a
        node to the card's DOM. — **A masked `::before`; no DOM node was added anywhere.**
- [x] **4. Apply the utilities and remove the literals they replace.** `Card`, `CardHiddenSide`,
      `CardRevealSide`, `CardStack`. Every border, radius or shadow still written inline in those
      files either becomes a token or is deleted. — **Three `rounded-2xl` became `rounded-card`;
      `border border-border` on the backs became `card-ring-dim`. `CardHiddenSide` needed no
      change — see open question 2 on the QR's surround.**
  - [x] `CardStack`'s backs stay **empty divs** — no content, no QR, no id. The dimmer ring is a
        class on an empty element, and it must not become a reason to render anything inside one.
  - [x] Nothing interactive goes inside `Card`. Two existing tests assert this; do not weaken them.
        — **Both still pass unmodified.**
- [x] **5. Decide whether the ring animates, and record the answer either way.** — **It does not.**
  - [x] ~~If it does: add a fourth `data-motion` hook, a fourth rule in the
        `prefers-reduced-motion` block, and a line in the canary test.~~ Not taken.
  - [x] If it does not: say so in the CSS comment, because "why is the ring the only static thing"
        is otherwise a question the next session re-answers from scratch. — **Said, in the ring
        token block's header, with the three reasons.**
- [x] **6. Re-audit contrast against the new values, computed and not eyeballed.** Every
      foreground/background pair in the app, not only the ones that changed — a new surface value
      moves ratios for text that was never touched. — **38 pairs. The calculator was validated
      against all 16 of Phase 7's numbers before being trusted with a new one; see execution
      note 5.**
  - [x] WCAG 1.4.3 for text: 4.5:1 normal, 3:1 large. The year, the muted lines, the placeholder,
        the disabled controls and the on-accent and on-danger labels are the pairs Phase 7 found
        problems in and are the ones most likely to break again. — **All pass. No surface moved, so
        every pair not involving a new token is unchanged to the digit.**
  - [x] WCAG 1.4.11 for non-text: the focus ring against every surface it can land on, at 3:1. If
        the ring itself ever conveys state rather than decoration, it joins this list. — **Six focus
        pairs, and the audit found one at 2.65:1 that nothing had ever measured. Exempt, with the
        reason recorded; it is not a Phase 8 regression. The neon ring is decoration and is
        measured anyway — all six stop/face pairs clear 3:1.**
  - [x] `--color-fg-decorative` is deliberately failing at 1.94:1 today because it is `aria-hidden`
        decoration. Re-confirm that exemption still holds under the new palette or fix it. —
        **Re-confirmed, unchanged at 1.94:1: the exemption depends on `--color-surface-raised`,
        which did not move.**
  - [x] Replace the table in `agent_findings.md` rather than appending a second one. Two contrast
        tables describing different builds is worse than one. — **Replaced. The Phase 7 narrative
        was kept because no token it introduced changed value, and the four ratios it corrected are
        preserved in one closing paragraph so the record is not lost.**
- [x] **7. Update `theme-color` in `index.html` by hand if `--color-page` moved.** A `meta` content
      attribute cannot hold a `var()`, so this is the one duplicated colour in the app and the file's
      own comment says it must be updated by hand. Getting it wrong puts a mismatched bar above the
      app on every phone. — **No-op, and CHECKED rather than assumed:** `--color-page` did not move,
      and `oklch(14.5% 0 none)` converts to exactly `#0a0a0a`, which is what the tag already holds.
- [x] **8. Grep the built CSS for every new utility.** Build, then search `dist/assets/*.css` for
      each new class and each new custom property. This is not belt and braces: an unknown Tailwind
      colour utility is a **silent no-op** and all four local checks pass either way. It has shipped
      once in this repo, and the symptom was near-black text on a near-black card. — **All 14 new
      names emit; see execution note 4 for what the grep turned up about the mask.**
- [x] **9. Add `vite-plugin-pwa` as a devDependency and register it in `vite.config.ts`.** pnpm only.
      `devOptions` stays off, so neither `pnpm dev` nor `npx vercel dev` starts serving a worker —
      a service worker in development is a caching bug generator, and this repo's dev story is
      already delicate enough. — **`vite-plugin-pwa@1.3.0`, `generateSW`, `registerType: 'prompt'`.
      `devOptions` absent.**
- [x] **10. Generate the icon set.** 192×192, 512×512, a 512×512 **maskable** variant, and a 180×180
      apple-touch-icon. PNG, because manifest icon support for WebP is not universal and iOS ignores
      the manifest's icons entirely in favour of the apple-touch link.
  - [x] Recover the original 1254×1254 source from git history rather than upscaling `logo.webp`.
        Record the commit it came from in `agent_findings.md`. — **Recovered from `667b974`
        (2026-08-03), deleted in `5e178f6`. It turned out NOT to be the same artwork as
        `logo.webp` — see execution note 6, which is where this step's premise broke.**
  - [x] **Do not re-add a large PNG to `public/`.** The favicon stays `logo.webp`. Each generated
        icon is only as large as its own dimensions require, and the total added weight goes in the
        findings entry — the 1.26 MB lesson is two weeks old. — **278.0 kB across the four icons,
        none of them on the critical path, all palette-quantised. `logo.webp` was regenerated from
        the same source and came out at 10,376 bytes, BELOW the 20,610 it replaced.**
  - [x] The maskable variant needs its own safe-zone padding. A maskable icon that is just the 512
        renamed gets its edges cropped on Android. — **Its own file. The artwork's content radius
        was measured (95.1% of the source's half-width), so it is drawn at 84% of the canvas,
        putting content at a 204.9px radius against the 204.8px safe radius.**
- [x] **11. Write the manifest as a typed module and import it into the plugin config.** Name,
      short name, description, `start_url`, `display: standalone`, `background_color`, `theme_color`
      matching `--color-page` after step 1, the icon set, and an orientation decision. —
      **`src/pwa/manifest.ts`, typed `Partial<ManifestOptions>`. No `orientation` field.**
  - [x] `theme_color` here and the `meta` tag in `index.html` are now a **third** copy of the page
        colour. Note it beside the existing warning, or derive both from one place. — **Noted in the
        module's header, and PINNED: `manifest.test.ts` reads `src/index.css` and asserts
        `--color-page`'s literal, so a token change fails a test rather than drifting silently.
        None of the three can derive from another; that is stated rather than worked around.**
- [x] **12. Configure workbox to precache the build output and nothing else.**
  - [x] A navigation-fallback denylist covering `^/api/`, so the shell is never served in place of
        a function response. — **Present in the generated worker.**
  - [x] No runtime caching rule for `/api/playlist` or `/api/year`. This is a decision, not an
        omission — write it in the config comment. — **`runtimeCaching: []` with the reasoning
        beside it. The worker's one `registerRoute` call is the navigation fallback, not a cache.**
  - [x] Confirm the code-split chunks (`GameScreen`, the `qrcode` chunk) are in the precache
        manifest. They are hashed build output, so they should be, but a chunk that is fetched
        lazily and precached eagerly is worth verifying rather than assuming. — **Verified against
        the emitted `dist/sw.js`, not assumed: all seven lazy chunks are listed. The check also
        found five DUPLICATE entries, which is execution note 7.**

> **Steps 13–17 are the manual half, and ALL FIVE ARE STILL PENDING.** Every one of them needs
> something this environment does not have: a preview deployment, an installed app on a real phone,
> an airplane-mode toggle, Lighthouse, or a running screen reader. They are listed unchecked rather
> than described as done, and the reasons are per-step below. **One thing was verified in a real
> browser** — see execution note 8, which is not a substitute for any of these five.

- [ ] **13. Keep the waiting update strategy and verify what a user sees.** Deploy, load, deploy
      again, reload. The old worker should keep serving until the tab closes. Confirm that a
      mid-game reload does not produce a missing-chunk error.
  - **PENDING — needs two deployments.** What IS verified locally, by reading the generated
    `dist/sw.js`: `skipWaiting()` appears only inside a `message` listener gated on a
    `SKIP_WAITING` payload, nothing in the app posts that message, and there is no
    `clientsClaim()`. So the worker is configured to wait. That the waiting is _invisible and
    harmless to a player mid-game_ is the part only a redeploy can show.
- [ ] **14. Verify the offline story end to end, and change nothing if it already works.** With the
      app installed and the network off: the shell loads; a saved session resumes and is playable
      without audio; pressing Start produces Phase 7's `offline` copy rather than a hung request.
      If all three hold, this step writes documentation and no code.
  - **PENDING — needs an installed app and a network toggle.** The precache list was verified to
    contain the shell, the CSS and all seven lazy chunks, and `runtimeCaching` is empty, so the
    three outcomes are what the configuration implies. None of the three has been observed.
- [ ] **15. Re-run Lighthouse on the landing screen, production build, all four categories.** The
      number to protect is **Performance 99**; the number to watch is CLS, because a glow that
      paints late is a layout-stable change and a ring that resizes the card is not. Record the
      scores beside Phase 7's so the comparison is one table.
  - **PENDING — Lighthouse is not installed here.** Worth knowing before it runs: the ring adds
    **no layout**, so CLS should be untouched. `--ring-width` is a border inside a `border-box`
    element and the glow is a `box-shadow`, neither of which participates in layout; the card's
    measured box is 288×448 exactly as before. The CSS bundle went 24.61 → 24.9 kB. The new risk
    Lighthouse should be pointed at is **paint** rather than layout: two `box-shadow` blooms plus a
    masked pseudo-element on a 3D-transformed element.
  - [ ] Accessibility 100 is a floor and not a result — it is an automated pass over a static
        screen. Do not let it stand in for step 16.
- [ ] **16. Run the screen-reader pass over one flip.** Phase 7 debt, and the one it names as most
      valuable. Flip a card with a screen reader running and confirm `CardRevealSide`'s polite live
      region announces the year. Confirm the hidden face announces nothing about the track.
  - **PENDING, and it is the most valuable outstanding item in the phase.** Nothing about it was
    discharged here. What this plan did do is leave it reachable: `CardRevealSide` still mounts only
    while flipped, its `role="status"` is untouched, and the year's colour change is the only edit to
    that component — so the pass tests exactly what Phase 7 built.
  - [ ] Record the reader and platform used. "It worked" without naming NVDA or VoiceOver is not a
        result anyone can build on.
- [ ] **17. Three widths and the reduced-motion pass, if the redesign touched either.** A ring with
      a glow changes what reduced motion has to suppress, and a fluid card with a new border width
      changes what the clamp resolves to. Both are Phase 7 rows in `development.md` §5 that this
      plan can either discharge or leave Pending — but not silently invalidate.
  - **PENDING, and the plan's warning about not silently invalidating them is the operative part.**
    Reduced motion: the ring does **not** animate (open question 1), so the `prefers-reduced-motion`
    block still covers exactly the three surfaces it covered before and that row is unchanged rather
    than invalidated. Three widths: the ring is a border on a `border-box` element, so the clamp
    resolves to the same 288×448 it did — **but the two peeking backs turn out not to render at all
    at the card's full height**, which the three-widths pass would have caught and which execution
    note 9 records. That row is now more valuable than it was, not less.

---

## Unit Tests

- [x] `should name every new ring and glow token` — the `@theme static` block, in
      `src/index.css.test.ts`. Text-level canary, same as the existing block, and labelled as one.
      — Landed as `should name every ring and glow token in the theme block`, and it asserts
      **`@theme static`** as well as the ten tokens: these are the first tokens in the app reachable
      only from an `@utility`, so `static` is the thing actually holding them alive.
- [x] `should define the ring utility and its dimmed variant` — `src/index.css.test.ts`. — Plus a
      `not.toMatch(/oklch\(/)` over the utility body, so a literal cannot creep back in.
- [x] ~~`should name the ring in the reduced-motion block`~~ — **not written, because step 5 decided
      the ring does NOT animate.** The plan's own instruction: a test asserting a rule that should not
      exist is worse than none.
- [x] `should apply the ring utility to the card` — `src/components/Card.test.tsx`, a class-name
      assertion. This is the silent-no-op guard, and `CardHiddenSide.test.tsx` already has one to
      copy the shape from. — Landed covering **both faces**, and it asserts `absolute` alongside
      `card-ring`: the utility sets no `position`, so the caller being positioned is a real contract.
- [x] `should apply the dimmed ring variant to each back` — `src/components/CardStack.test.tsx`. —
      Also asserts the full `card-ring` is **absent**, with a word-boundary match, since
      `card-ring-dim` contains it as a substring and a `toContain` would pass on the dimmed class.
- [x] `should render each back with no content, no QR and no id` — `src/components/CardStack.test.tsx`.
      Exists; re-run rather than rewrite, and do not let the ring class become an excuse to relax it.
      — **Re-run unmodified, passing.**
- [x] `should render no live region on the hidden face` — `src/components/CardHiddenSide.test.tsx`.
      Exists. It is the assertion the redesign is most likely to break by accident. — **Re-run
      unmodified, passing.**
- [x] `should declare the fields an installability check requires` — `src/pwa/manifest.test.ts`,
      node environment. Name, short name, `start_url`, `display`, and at least a 192 and a 512 icon.
- [x] `should declare a maskable icon with its own purpose` — `src/pwa/manifest.test.ts`. — Landed as
      `should declare a maskable icon that is a separate file from the full-bleed 512`, which is the
      failure worth catching: `purpose: 'any maskable'` on one file validates and crops.
- [x] `should point theme_color at the same value as the page token` — `src/pwa/manifest.test.ts`.
      The manifest is now the third copy of that colour; this is the only one a test can hold. —
      **Two tests.** The second reads `src/index.css` and pins `--color-page`'s literal, because
      asserting `theme_color === PAGE_COLOR` alone would only prove the module agrees with itself.

---

## Documentation Updates

- [x] `docs/architecture.md` §3 — the ring utilities and why they are utilities rather than a
      component; the icon set and where its source came from; the service worker's position, its
      precache scope, and the two things it deliberately does not cache. — **Two new subsections
      ("The neon ring" and "The installable shell"), plus the token-layer intro corrected: it said
      "two `@utility` composites" and there are now four.**
- [x] `docs/development.md` §5 — new manual rows: the installability check, the offline resume, the
      update-on-redeploy check, and the post-redesign Lighthouse re-measure. Mark the screen-reader
      row Done with the reader named, or leave it Pending and say so. — **A seven-row Phase 8
      look-and-shell table. The screen-reader row is left PENDING and says so explicitly, in a
      callout, with the reason it was carried and not run.** Two Phase 7 rows were also corrected
      rather than silently invalidated: the reduced-motion pass gains a note that the ring does not
      animate, and the peeking-backs row now reads **FAILS** with the measurement.
- [x] `docs/development.md` §8 — what offline does and does not cover, and the waiting-update delay
      as a deliberate limitation rather than a bug. — **Four new bullets: offline coverage, the
      waiting-update delay, the peeking-backs defect, and the fact that the redesign has been seen in
      exactly one browser render.**
- [x] `docs/agent_findings.md` — the re-audited contrast table replacing Phase 7's; the icon
      provenance and total added bytes; the post-redesign Lighthouse scores; anything the PWA work
      turns up. Date every entry, and tell the developer they were added. — **Six entries, all dated,
      and the developer was told. The contrast table REPLACED Phase 7's rather than sitting beside
      it. The Lighthouse scores are the one item not recorded, because step 15 did not run.**
- [x] `docs/plans/plan.md` §5 — tick the card-design and PWA boxes; add a Phase 8 completion note in
      the style of Phases 3–7; record explicitly that the prerendering item was **retired by the
      favicon fix** rather than built, because "LCP is gated on React mounting" is a conclusion that
      will be re-reached by the next person who reads Performance 75 in an old note. — **Both boxes
      ticked with their sub-bullets, a completion note added, the heading changed to "code complete;
      every remaining item is manual verification", and prerendering written up as its own bullet
      ending "read the network log before blaming the architecture".**
- [x] `AGENTS.md` — current-phase line; the service worker as a structural fact, including that it
      does not cache the API and that development never registers one. — **Current phase is now "8,
      CODE COMPLETE" with the remaining work named as manual. Three new structural facts: the service
      worker's two deliberate omissions, the ring's no-`position` rule, and the three Phase 8 findings
      (two that read as bugs and are not, one that is).**
- [x] `README.md` — that the app is installable, what offline covers, and that an update lands after
      every tab is closed. — **A new "Install it on your phone" section in the README's own
      plain-language register, plus four new Known limitations. The title and status line now say
      "Playlist Hitster" and Phases 0–8.**
- [x] `index.html` — the icon links, and the `theme-color` comment updated if the value moved.
      Comments here are shipped bytes: keep the reasoning in `architecture.md` and the constraint
      in the file. — **The `apple-touch-icon` link added with a one-line reason (iOS ignores the
      manifest's icons). `theme-color` did not move, so its comment stands unchanged; the favicon
      comment's byte count was corrected 20 kB → 10 kB. The manifest link is injected by the plugin,
      so it is not hand-written here.**

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

| #   | Assumption / Decision                                                   | Rationale                                                                                                                                                                |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | The ring is tokens plus `@utility` composites; no new component         | Chosen over a `NeonRing` component and over a values-only recolour. Avoids a decorative node inside the leak-critical subtree and a second place to teach reduced motion |
| 2   | Prerendering is **not** in this plan                                    | Already retired. The favicon fix took the landing screen from Performance 75 / LCP 7.8 s to 99 / 1.6 s with no code touched                                              |
| 3   | The logo/asset item is **already discharged**                           | `public/logo.png` is gone; `public/logo.webp` is 240×240 and 20,610 bytes. What remains is the PWA icon set, which is a different asset for a different purpose          |
| 4   | Contrast is re-audited as a step, not as a follow-up                    | A new palette makes Phase 7's measured table describe a build that no longer exists, and an unknown colour utility fails silently with all four checks green             |
| 5   | The service worker precaches build output only — no API runtime caching | A cached playlist response can deal a deck that no longer matches the real playlist. Offline is worth having; a wrong deck is not                                        |
| 6   | The update strategy waits rather than `skipWaiting`                     | `GameScreen` and `qrcode` are lazy chunks. An activation mid-game after a redeploy makes the next card a missing-chunk error                                             |
| 7   | The manifest is a typed module imported by `vite.config.ts`             | Makes the installability-critical fields assertable in a node test. A literal inside a plugin call cannot be imported                                                    |
| 8   | Icons are PNG, generated from the pre-deletion source in git history    | Manifest WebP support is not universal and iOS ignores manifest icons entirely; upscaling the 240px WebP would produce a soft 512                                        |
| 9   | The screen-reader pass rides with this plan                             | It is Phase 7's highest-value outstanding check and it covers the component this plan is rebuilding around                                                               |
| 10  | `--color-page` and `--color-surface` are expected to stay near-black    | Preserves most of the contrast table, suits an OLED phone, and is what makes a neon ring read as neon. Step 1 may overturn it, but it is the starting position           |

---

## Open Questions

_All four resolved by the developer on 2026-08-06, before any CSS was written. Execution note 1
carries the values that follow from them._

- [x] **Does the ring animate?** **No.** It is a static gradient border plus a static outer bloom.
      Three animation surfaces stay three, the `prefers-reduced-motion` block keeps its two
      declarations plus one, and the canary gains no motion assertion. The CSS says so out loud, per
      step 5's second bullet — "why is the ring the only static thing" must not be re-answered from
      scratch next session. It also keeps step 15 honest: a pulsing bloom is the one version of this
      change that could give back Performance 99.
- [x] **Does the QR's surround change?** **No, and that is the point.** The mockup draws the code as
      a white field on the dark face, which is exactly what ships today — `QrCode` renders
      `bg-white` with `margin: 1` module of quiet zone. The ring is 2px at the card's edge and the
      face keeps its `p-6`, so at the 288px ceiling there are 24px of dark padding plus the quiet
      zone between the code and the nearest coloured pixel. **No glow, no coloured field and no
      gradient goes behind the code**, so this plan adds nothing to the scan check Phase 4 already
      owes and does not turn it into a blocker.
- [x] **Does `--color-page` move, and if so how many places copy it?** **It does not move.**
      Assumption 10 holds for `--color-surface` and `--color-surface-raised` too. Consequences:
      step 7 is a **no-op** (`index.html`'s `theme-color` stays `#0a0a0a`), Phase 7's contrast table
      survives for every pair that does not involve a new token, and the manifest is the third copy
      of the colour but the only one a unit test can hold — which is why one exists.
- [x] **Orientation lock in the manifest?** **No lock**; the field is omitted. Phase 7's
      `clamp(18rem, min(62dvh, 124vw), 28rem)` already exists so that a short wide viewport gets a
      smaller card rather than an overflowing one, so landscape is a supported layout rather than a
      tolerated one, and `display: standalone` on a laptop has no orientation to lock anyway.

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

---

## Execution Notes

### 1. The target palette, written before any CSS (step 1)

The reference the redesign is drawn from is **`docs/plans/custom-hitster-mockup.png`**, which was
already in the repo — a green → cyan → magenta gradient ring on a near-black card, on a near-black
page. Reading it is what turned "take cues from the reference repo's neon-ring aesthetic" into the
value table below.

**Nothing that already exists changes value.** That is the whole of the surface decision and it is
worth stating as a result rather than as a default: every token Phase 7 named keeps its `oklch()`,
including all three surfaces, so **the only rows this plan adds to the contrast table are rows for
tokens that did not exist**, and every pair Phase 7 measured is still that ratio. Open question 3
above is why.

| Token                | Value                       | From the mockup    | Notes                                                                         |
| -------------------- | --------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `--color-ring-from`  | `oklch(88% 0.2 152)`        | the green stop     | The ring's first stop, and the value `--color-fg-year` copies                 |
| `--color-ring-via`   | `oklch(85% 0.13 205)`       | the cyan stop      | The middle stop, and what `--color-ring-dim` is a darkened version of         |
| `--color-ring-to`    | `oklch(65% 0.25 310)`       | the magenta stop   | The darkest of the three at 4.13:1 on the reveal face — still over 3:1        |
| `--color-ring-dim`   | `oklch(55% 0.08 205)`       | the stack's edges  | Replaces `border-border` on the backs, which was **1.31:1** — invisible       |
| `--color-ring-glow`  | `oklch(85% 0.16 175 / 0.3)` | the outer bloom    | Between the green and cyan stops. Alpha is in the token, not at the call site |
| `--color-fg-year`    | `oklch(88% 0.2 152)`        | the year, in green | **New**, and the one text colour this plan changes. See note 2                |
| `--ring-width`       | `2px`                       | —                  | 2px at the 288px ceiling and at the 185px floor alike; it must stay crisp     |
| `--ring-glow-blur`   | `1.25rem`                   | —                  | 20px of bloom                                                                 |
| `--ring-glow-spread` | `-0.25rem`                  | —                  | Negative, so the bloom hugs the ring instead of washing the page              |
| `--radius-card`      | `1rem`                      | —                  | Exactly the `rounded-2xl` it replaces in three places. Nothing moves          |

**A second accent family is now a stated decision rather than an accident.** `--color-accent`
(emerald) remains the **action** colour — Start, Play again, the Play control — and the ring is
**decoration that never conveys state**. The two therefore never compete for meaning, which is the
condition that makes two families acceptable; if the ring ever indicates something, it needs a
contrast budget and a place in the 1.4.11 list.

### 2. The year is the one text colour that changes, and it is flat on purpose (steps 1, 4, 6)

The mockup renders the year in the ring's gradient. It ships as a **flat** `--color-fg-year`
instead, at the gradient's green stop, and the reason is step 6 rather than taste: **a gradient has
no single contrast ratio**, so `background-clip: text` on the largest and most important text in the
app would put the phase's headline element outside the one audit this plan is required to compute.
The failure mode is worse than the missing polish, too — `background-clip: text` needs
`color: transparent`, so a gradient that does not paint renders the year **invisible**, and that is
the same silent-failure shape as the unknown-colour-utility bug this repo already shipped once.

A flat bright green measures **11.30:1** on the reveal face, is one number a future session can
re-check, and cannot fail to a blank slot. `--color-fg-strong` (14.48:1) is what it replaces, so the
year gets more colour and keeps well over its 3:1 large-text floor.

### 3. Neither ring utility sets `position`, and the reflex fix is the bug (step 3)

`card-ring`'s gradient band is a `::before` with `position: absolute`, which needs a positioned
ancestor — so the obvious move is `position: relative` inside the utility. **That would be a real
bug here.** Both call sites are already `absolute inset-0` (the two faces in `Card.tsx`, the backs in
`CardStack.tsx`), the two declarations land in the same cascade layer, and which one wins depends on
the order Tailwind happens to emit two custom utilities in. If `relative` won, both faces would drop
out of absolute positioning and stack in flow — the card would come apart.

So the contract is **the caller is positioned**, and it is pinned at both ends in the house style for
anything whose middle is untestable: `index.css.test.ts` asserts neither utility declares a
`position`, and `Card.test.tsx` / `CardStack.test.tsx` assert `absolute` sits beside the ring class
on every element that carries it.

### 4. The mask needed no hand-written prefixes, and the grep is how that was established (step 8)

The gradient border is the standard two-layer mask subtraction — `content-box` layer excluded from a
`border-box` layer, leaving the `padding: var(--ring-width)` band. `mask-composite: exclude` is the
load-bearing declaration and the one with the least uniform support, so step 8's grep over
`dist/assets/*.css` was checking for more than the class name.

**Lightning CSS expands and prefixes it automatically.** The authored two-line `mask` shorthand comes
out as the full longhand set with `-webkit-mask-image`, `-webkit-mask-clip`, `-webkit-mask-origin` and
`-webkit-mask-composite: xor` beside every standard property. Nothing had to be written by hand, and
now nothing should be: adding prefixes manually would duplicate what the pipeline already emits.

All 14 new names — ten tokens, two utilities, `rounded-card` and `text-fg-year` — emit rules.

### 5. The contrast calculator was validated before it was trusted (step 6)

A new contrast script producing plausible numbers is worth very little, so it was pointed at
**Phase 7's 16 recorded ratios first** and had to reproduce every one to the last recorded digit
before it was used on a new value. It did — but not on the first attempt, and the discrepancy is the
useful part:

**Alpha compositing must be done on gamma-encoded sRGB, not in linear light.** Two of the sixteen
disagreed until that was fixed. `--color-fg` at `--opacity-disabled` over `--color-surface-raised`
came out at **8.72:1** against the true **5.94:1** — a two-and-a-half-stop error, in the direction
that makes a failure look like a pass. Without Phase 7's numbers to check against, that error would
have been invisible and the new table would have been quietly wrong. Recorded in
`docs/agent_findings.md`.

### 6. Step 10's premise was wrong: the two logos are different artwork (step 10)

The step says to recover the pre-deletion source "rather than upscaling `logo.webp`", which assumes
the WebP is a re-encode of the PNG. **It is not.** Both changed in commit `5e178f6`: the 1.26 MB
`logo.png` was deleted and a 20,610-byte `logo.webp` was added in the same commit, and they are
**different images** — the PNG is the "PLAYLIST HITSTER" card-stack wordmark, the WebP was a circular
neon "HITSTER". Phase 7's note that the favicon "replaced a 1.26 MB PNG" is true about the bytes and
silent about the artwork, so nothing recorded that the brand had changed.

Escalated rather than guessed, because a home-screen icon is an identity decision. **The developer
chose one identity everywhere** (2026-08-06): all four PWA icons _and_ a regenerated `logo.webp` come
from the recovered 1254×1254 source, which is also the mark the redesign's own reference —
`docs/plans/custom-hitster-mockup.png` — draws in its header. The favicon came out **smaller** than
the file it replaced (10,376 vs 20,610 bytes).

The maskable variant was sized by measurement rather than by a guessed padding: the artwork's content
radius is 95.1% of the source's half-width, so drawing the whole square at 84% of the canvas puts
content at a 204.9px radius against the 204.8px safe radius of the 80% circle. Verified by rendering
it under a simulated circular mask; nothing is clipped.

### 7. Five duplicate precache entries, benign today and a build failure tomorrow (step 12)

The step asks for the lazy chunks to be _verified_ in the precache manifest rather than assumed. They
are all there — and the same inspection found **five duplicated entries**: both 512s, the 192, the
favicon and the apple-touch-icon each appeared twice.

Two overlapping causes, both removed. `includeAssets` listed files that `globPatterns` already matched
(`public/` is copied to the build root, and the glob covers `png`/`webp`), and the plugin adds every
manifest-declared icon itself, which the glob was matching a second time — so `globIgnores:
['pwa-*.png']` leaves those three to the plugin while keeping `apple-touch-icon.png`, which is
referenced from `index.html` rather than the manifest and is therefore only reachable via the glob.

Worth doing rather than tolerating: the revisions were identical, so workbox deduplicated silently
instead of throwing `add-to-cache-list-conflicting-entries`. It was invisible, and it would have
become a **build-time throw** the moment the two paths disagreed about a revision. 19 entries now,
no duplicates, nothing missing.

### 8. The ring was rendered in a real browser, because jsdom cannot (steps 4, 8)

Class-name assertions are the automated ceiling, and they say nothing about whether a masked
pseudo-element and two layered `box-shadow`s actually paint. So the built stylesheet was loaded into
a throwaway static page reproducing `Card`'s and `CardStack`'s exact class strings, and screenshotted
in Chrome.

The ring paints: a green → cyan → magenta band following the card's corners, on both faces, with the
year in neon green on the reveal side. **The glow was retuned as a result** — at the first values
(`0.3` alpha, `1.25rem` blur) the bloom was barely perceptible against the page, so
`--color-ring-glow` went to `0.45` and `--ring-glow-blur` to `1.75rem`. That is the one value in
note 1's table that was set by looking rather than by measuring, and it is the only kind of value
that should be.

**This is not a substitute for steps 15–17.** It is one viewport, one browser, no OS preferences, no
assistive technology and no Lighthouse.

### 9. The two peeking backs do not render at all on a full-height card (found in step 4)

The most important thing this plan turned up, and it is **pre-existing rather than caused here** —
Phase 5's `BACK_OFFSET_PX = 10` and `BACK_SCALE_STEP = 0.04`, which `AGENTS.md` already records as
numbers "chosen by eye" that "have never been seen on a phone". They have now been seen, and they do
not work at the card's full height.

Measured in the browser at the card's 448px ceiling, via `getBoundingClientRect`:

| Element | Height | Peek below the card | Inset each side |
| ------- | ------ | ------------------- | --------------- |
| back 1  | 430.08 | **1.04px**          | 5.76px          |
| back 2  | 412.16 | **2.08px**          | 11.52px         |

`scale()` is centre-origin, so it pulls the bottom edge **up** by `(H / 2) × step` — 8.96px at
H = 448 — while `translateY` only pushes it **down** by 10px. Net peek is 1px and 2px, on the bottom
edge only, and the card's own 2px ring covers it completely. Every other side is inset, i.e. hidden
behind the card.

**The cue degrades as the card grows, which is backwards.** At the 288px floor the inset is 5.76px
against the same 10px offset, so back 1 peeks by a marginal 4.24px. The condition for any visible
peek is `BACK_OFFSET_PX > (H / 2) × BACK_SCALE_STEP`, and nothing enforces it.

**Deliberately NOT fixed here.** It is outside this plan's steps; Phase 7 open question 2 explicitly
resolved to keep the offset absolute; and `AGENTS.md` names these constants as the first place to look
for touch problems, so changing them is a deck-feel decision rather than a bug fix. What it does mean
is that `card-ring-dim` — added by step 4 to take the backs from 1.31:1 to 4.23:1 — **is currently
inert on a desktop-sized card**, because there is nothing of the backs to see. The colour fix is
correct and the geometry has to be decided separately.

> **RESOLVED 2026-08-06, outside this plan, and not by retuning either constant.** A player described
> the same defect from the other side — sliding the top card aside showed "two cards, one inside the
> other", which is what an inset back looks like when it is finally uncovered. The deck-feel decision
> was made: **one back, `absolute inset-0`, no transform, holding the next card's hidden face with its
> QR preloaded.** `BACK_OFFSET_PX` and `BACK_SCALE_STEP` are deleted, and so are `card-ring-dim` and
> `--color-ring-dim` — a flat dim border was right for a two-pixel sliver and wrong for a full-size
> card face, which now takes `card-ring` plus the new `card-ring-quiet` (glow suppressed via a custom
> property, because the back's box is pixel-for-pixel the front card's and two blooms composite). This
> plan's step 4 scope line, "the two peeking backs get a dimmer ring variant, they stay empty divs", is
> therefore superseded. See [`agent_findings.md`](../agent_findings.md) (2026-08-06).

### 10. `vercel.json` needs no change, and that was checked rather than assumed

The scope table flags the SPA rewrite as a **Review** item with the instruction "verify, do not
assume". Verified by running the actual pattern — `/((?!api/|@)[^.]*)` — against the paths the worker
introduces:

| Path                    | Result                  |
| ----------------------- | ----------------------- |
| `/sw.js`                | served as a file        |
| `/workbox-*.js`         | served as a file        |
| `/registerSW.js`        | served as a file        |
| `/manifest.webmanifest` | served as a file        |
| `/pwa-512x512.png`      | served as a file        |
| `/api/year`             | served as a file        |
| `/`, `/anything`        | rewritten to index.html |

The `[^.]*` term is what does it: every new path contains a dot, so none of them can match, and the
capture group cannot span one. **No edit to `vercel.json`.** Worth having checked rather than reasoned
about loosely — a rewritten `/sw.js` would serve `index.html` with a 200 and an HTML content type,
which registers as a script-evaluation failure rather than a 404 and would have been diagnosed as a
worker bug.
