# Decisions and invariants

The long-form reasoning behind the rules in [`AGENTS.md`](../AGENTS.md). Until 2026-10-01 every block
below lived in `AGENTS.md` itself; it was moved here **verbatim**, regrouped by area, so that `AGENTS.md`
could stay short enough to read in every session. `AGENTS.md` keeps one line per invariant and points
here for the why.

Each block is dated by the day it was written, and some say "the block above" or "below" — that
refers to the old `AGENTS.md` order; search this file for the block's opening words instead.
Only the relative link targets were adjusted (`./docs/x.md` → `./x.md`); the words are unchanged.

## Project status, in full

**Do not build ahead of the current phase.** The plan defers things deliberately. Current phase: **8, CODE COMPLETE.** The work after it is the **year-fetch rework**, four plans built in order — [`mb-fixes`](./plans/plan.year-fetch-rework-mb-fixes.md), [`server`](./plans/plan.year-fetch-rework-server.md), [`game`](./plans/plan.year-fetch-rework-game.md) and [`ui`](./plans/plan.year-fetch-rework-ui.md) — whose status is kept in the index above and nowhere else. Phases 1–7 are complete, all three Phase 8 plans are resolved, and the app is playable end to end, has a design surface, is installable, and fails legibly. `src/App.tsx` is the **real container** and the only caller of `useGameSession()`. Plan 2 built the shareable deck URL, the saved-playlist library, the printable PDF export and the audio reversal; plan 1 built the neon ring, the contrast re-audit, the PWA and the icon set; plan 3 resolved "Added by" as won't-build with no code. Note that plan 2 depended on plan 1 only **softly** and did not wait — so the PDF's print palette is deliberately its own and did not change when the screen was redesigned. **Two developer requests landed on 2026-09-18 outside any plan**: a welcome screen in front of the picker (with a printable year-cards PDF), and a left swipe that steps BACK a card. Both blocks are below.

## Copy and languages

**EVERY SENTENCE THE PLAYER READS LIVES IN `src/game/copy.ts` AS OF 2026-08-12, AND THE RULE HAS TWO
ENDS: A COMPONENT RENDERS `COPY.*`, AND A TEST ASSERTS AGAINST `COPY.*`. Neither may hold a
literal.** The wording of the app used to be pinned in ~200 places across eighteen test files —
`getByText` with a full sentence, `getByRole('button', { name: /copy share link/i })`,
`toContain('1 playlist could not be loaded and was left out.')` — so rewording one button meant
hunting its literal through the suite, and **copy that is expensive to change is copy that stops
being edited**. Routing both ends through one constant keeps the BEHAVIOUR asserted while making the
WORDS free: change a string and no test fails, because no test ever knew what it said. Four things
to know. **A value that varies is a FUNCTION, never a template a caller assembles** —
`COPY.hud.cardsLeft(n)` owns its own pluralisation, so a test can ask for the exact string the
component will render, and `App.test.tsx`'s `cardsLeftInHud()` reads the count BACK through it
rather than with a regex over the sentence. **`messages.ts` deliberately stays where it is**: it is
already one keyed map, typed `Record<StartFailureCode, string>` so a new code fails the typecheck,
and that exhaustiveness is what folding it into a loose object would cost. **`index.html`,
`src/pwa/manifest.ts` and `public/privacy.html` are outside the rule** — the first is shipped bytes on
the critical path, the second is read by `vite.config.ts` at BUILD time, and the third is served straight
out of `public/` with no build step at all, so none of the three can import a runtime module;
`COPY.app.name` is the value to copy from by hand in each. And **six assertions were DELETED rather than converted**, all of
them pure-wording checks with no constant to point at: the `/same deck/i` and `/new playlist/i` and
`Restart` absences, the `'our side'` phrase check, and `messages.test.ts`'s seven `toContain('private')`
-style substring assertions — replaced by "every code has a sentence of its own", which is the
property those were really defending and which survives any rewrite. Full reasoning in the module's
own header; the deletions are logged in [`docs/agent_findings.md`](./agent_findings.md).

**THE APP SPEAKS ENGLISH, SPANISH AND CATALAN AS OF 2026-09-28, AND `COPY` IS STILL THE ENGLISH
CATALOGUE — which is why no existing test changed.** `src/game/copy.ts` keeps `COPY` and now also
exports `type Copy` (its keys and signatures with every literal widened to `string`); `copy.es.ts` and
`copy.ca.ts` are `satisfies Copy`, and `messages.es.ts` / `messages.ca.ts` are `ErrorMessages`
(`Record<StartFailureCode, string>`), so **a key or a failure code added in English and forgotten in a
translation fails the typecheck**. `src/game/i18n.ts` is the one `Record<Locale, Catalogue>` table and
`src/game/locale.ts` the pure decisions (`LOCALES`, `matchLocale` on the primary subtag, the stored
choice under the NEW key `jitster:locale:v1`, validated on read). Components read the active catalogue
through **`useCopy()` / `useLocale()`** (`src/hooks/useLocale.ts`), and **the context's default value
is English** — a component rendered without a provider, i.e. in every existing test, gets exactly the
`COPY` object the test asserts against. Pure modules take the slice they need as a parameter defaulting
to English (`deckLabel(playlists, copy.deck)`, `pdfFileName(name, copy.pdf)`,
`playlistErrorMessage(code, errorMessages)`). Six things. **`LocaleProvider` wraps `ErrorBoundary` in
`main.tsx`, OUTSIDE it**, so the crash screen is translated — and so its storage read is guarded
(`readLocalStorage()`): a throwing `localStorage` getter there would be a white page with no crash
screen. **`ErrorBoundary` stays a class**; its fallback is a function component (`CrashScreen`) that
calls the hook and receives only the two handlers. **`<html lang>` follows the locale** (an effect in
the provider) because the reveal's live region is how a screen reader hears the year, and a Spanish
sentence under `lang="en"` is pronounced as English; `index.html` still ships `lang="en"`, as does the
manifest, which has one `lang` and names the default. **The footer, the app name and both file-name
prefixes are NOT translated** (the developer's decision for the footer): the translations reference
`COPY.footer`, `COPY.app` and `COPY.pdf` rather than restating them. **`SavedPlaylist.name` is now the
BASE name** (the first playlist's truncated name, no "+N more"), because the count is copy and a stored
label would keep the language it was saved in forever; `LandingScreen` composes the label at render,
and a legacy entry ending in exactly ` +${n-1} more` is stripped on read against a FROZEN literal, not
against `COPY.deck.label`, since it describes bytes already in storage. **The selector is on the
welcome screen AND, since 2026-10-01 (the developer's request), on the picker, IN FLOW as the last
section of each, under the same visible heading** (`LanguageSelector.tsx`, three `aria-pressed`
buttons, each language named in itself with a matching `lang`), never in a top corner: at 320px the
192px logo leaves ~40px beside it, moving the logo breaks the `pt-8` equal-height contract between the
two screens, and the picker's corner already holds Back. On the picker it takes `disabled` while a
request is loading, like every other control there. The game screen still has none (a height budget).
Share links and resumed sessions skip both screens and rely on detection. **Nothing about
the translations has been read by a native speaker**, and the screen-reader pronunciation is unverified:
rows in [`docs/development.md`](./development.md) §5. That includes the three keys the year-fetch
rework added on 2026-09-30 — `COPY.card.yearProvisional` ("Confirming year") — and the three option
labels of 2026-10-01 (`COPY.landing.dealYearless`, `COPY.landing.dealUnconfirmed`,
`COPY.deckActions.blankUnconfirmed`, `COPY.deckActions.printTitle`; the Spanish picker labels and print
title are the developer's own wording), whose
other translations are **unreviewed proposals**, said so in their own comments.

## Screens: welcome, picker, end screen, footer

**THE FRONT DOOR IS A WELCOME SCREEN AS OF 2026-09-18, IT IS A CONTAINER FLAG AND NOT A FIFTH STATUS,
AND `LandingScreen` STILL MEANS THE PLAYLIST PICKER.** `src/components/WelcomeScreen.tsx` explains the
game — the hero is the logo, ONE tagline (`COPY.welcome.tagline`; the lead sentence it used to carry was
cut on 2026-09-18 as a restatement of the three steps) and one big button reading `COPY.welcome.enter`,
then three ordered "How it works" steps and the printable year cards; the button lands on
`LandingScreen`, which kept its name because forty-odd doc and test lines use it. **The picker has a
Back button** (a ghost `<button>` absolute in the top-left corner, **icon-only since 2026-09-29** — an `aria-hidden` ← at `text-xl`, with `COPY.landing.backToWelcome` as its `aria-label` — out of flow, disabled while a
request is loading, required `onBack` prop) that returns to the front door — a `<button>` and not an
anchor, because there is no router and no history entry to go back to, and `App.tsx` still never touches
the address bar. `App.tsx` decides with `hasEnteredPicker`, a `useState` of the same shape as
`endedView`, and **the flag is set true by THREE things and cleared by ONE**: the welcome button, Exit
and Home set it; Back clears it — **and it is SEEDED from the link OR from a restored session**:
`useState(deckLink !== null || state.status !== 'idle')`, so a valid share link and a saved session both
count as having pressed through. The second term works only because `useGameSession` restores the save
in `useReducer`'s LAZY INITIALIZER, so the first render already carries the restored status — move
`RESUME` into an effect and the seed silently reads `idle`. Every branch that shows the picker — `idle`,
and both `ended` branches (`deckCollapsed`, and `endedView === 'landing'`) — returns the one `picker`
value, `hasEnteredPicker ? landing : welcome`, computed once, and nothing else. So **a share link never
sees the welcome screen** (it deals immediately, as it always did), **a saved session resumes past it**
(because it SEEDS the flag — not merely because a `preparing`/`playing` status skips the check; a resumed
deck that collapses reaches the `ended` branch and needs the flag true), and **Exit and Home land on the
picker** — no longer because those paths go through `ended` (through `ended` alone they would now reach
the front door) but because they SET the flag; Back is how a player gets from there to the front door.
**No branch checks `deckLink` any more, and the seed is what replaced the check**: the first version
guarded the `idle` branch with `deckLink === null`, which left a link whose fetch FAILED showing a Back
button that did nothing (the flag was already false and the guard still refused) and sent a link-dealt
deck that collapsed to zero to the front door instead of to the `no-years-found` warning. A THIRD hole
survived the link seed until 2026-09-19: a RESUMED session (a save taken during the card-1 gate, or a
pre-reversal save of all-null years) that drained to zero also reached `deckCollapsed` with the flag
false and showed the front door with no warning. Seeding the flag from the link and from the restored
status closes all three; a `deckLink` check anywhere reopens one. It is ephemeral: a reload shows the front door again, and a "seen it" flag
in `localStorage` was deliberately not built. Four things to know. **The PDF is `public/year-cards-1970-2033.pdf`, served statically and NOT precached** —
the worker's `globPatterns` has no `pdf` on purpose (240 kB on every install, for a file most players
never download), and `vercel.json`'s SPA rewrite already excludes any path with a dot. **It is pinned
`binary` in `.gitattributes`** (2026-09-19), because a PDFsharp file has no NUL in its first 8 kB, so git's
text heuristic let `core.autocrlf` strip its 23 carriage returns on add — the blob shipped 23 bytes short
with a broken `startxref` from `fbb4860` until the re-add; any future NUL-free binary needs the same line.
**`vite.config.ts` denylists `/\.pdf(\?|$)/` from the SPA fallback** (workbox's `NavigationRoute` matches
the denylist against `pathname + search`, so a bare `$` failed on any query string), because a controlled
tab navigating to a URL the worker has not cached is served `index.html` — the `download` attribute is not
a defence, since whether a download even reaches the worker as a navigation differs by browser. Neither
half is observable under any dev server. **The printed range "1970–2033" is the one year-shaped text on a
pre-start surface, and it is NOT in a sentence**: it lives in the PDF's saved name
(`COPY.welcome.yearCardsFileName`, the download link's `download` attribute) and in the asset path
(`YEAR_CARDS_PDF_PATH`, its `href`); `COPY.welcome.printDetail` carries only the start year. Until
2026-09-19 neither attribute was audited, so the leak proxy passed by OMISSION. The shared
`src/components/__fixtures__/auditable-text.ts` now audits `download` and `href` beside
`alt`/`aria-label`/`title`/`placeholder`/`value`, and `WelcomeScreen.test.tsx` first asserts the audit
READS both strings, then subtracts all three (plus `COPYRIGHT_NOTICE` and `COPY.footer.authorUrl`) by
exact string — reword any of them freely, but a new home for the range needs a new subtraction, or the
proxy fails, which is the intended failure.
And **the decorative card is the first `card-ring` caller that is not `absolute inset-0`**, so it carries
`relative` itself (and `rounded-card`, and `aria-hidden`, and draws a `?` rather than a number); its test
pins all four. The download link is the app's **second `<a>`**, with `focus-visible:focus-ring` and
`touch-target` applied by hand as the footer's was, and no `target="_blank"`.

**THE PICKER IS SIZED FROM THE FRONT DOOR AS OF 2026-09-21, AND THE TWO `pt-8`s ARE ONE NUMBER.** The
developer's report was that `LandingScreen`'s components read slightly smaller than `WelcomeScreen`'s,
and that the logo must sit at **exactly** the same height on both. The height half is the load-bearing
half: the Back button is out of flow and there is nothing above the hero on the welcome screen, so on
BOTH screens the hero is the first in-flow child and **the logo's top edge IS `<main>`'s top padding** —
`pt-6` against `pt-8` was an 8px jump on the one press between them. It is now `pt-8` on both, **pinned
at each end** by a test of its own, the same two-ended shape as `Footer`'s `relative`/`pb-20` contract
and for the same reason: one assertion alone lets the other screen drift away silently, and jsdom
computes no layout, so the class name is the whole of what is observable. The size half is four
class changes, all of them _toward_ the front door and none of them inventing a new scale: Start is
`WelcomeScreen`'s big button to the class (`px-6 py-4 text-lg font-semibold`) **minus its disabled
pair**, which that button does not need and this one does; the inputs, the "+" row and the saved-library
rows go `px-3 py-2 → px-4 py-3`; and `SuggestionButton` becomes `p-4 text-sm`, matching the "How it
works" step cards it sits in the same slot as. Three traps. **The `text-sm` had to move OFF the
`<label>` and ONTO its caption `<span>`** — Tailwind's preflight gives an `<input>` `font: inherit`, so
a type scale on the wrapper sizes the BOX's text too, which is the one thing the enlargement was for.
**The Back button widened with everything else (`px-3 → px-4`)**, and `LandingScreen`'s own header
recorded that at 320px it already grazed the logo's top-left corner — a row in
[`docs/development.md`](./development.md) §5. (Superseded 2026-09-29: the button is now the arrow
alone at `px-3`, so it is narrower than either version with the "Back" text.) And **the `<main>` gaps were deliberately NOT
unified**: the picker keeps `gap-8` (pinned by a test, with its own reasoning about the void between
Start and the suggestions) where the front door has `gap-10`. The ask was the size of the components,
not the spacing between them, and the logo's height does not depend on a gap.

**The end screen's second button says "Home", not "New playlist"** (renamed 2026-08-06). The landing
screen is also where the saved-playlist library is and where a shared link is pasted, so the old
label named one of three reasons to press it — and the only one the button does _not_ do. It touched
no state, because `EndedView` was already phrased as the **destination** `'landing'` rather than as
a reason. The test asserting the old label was absent went with the 2026-08-12 copy centralisation — the button's own `{ name: COPY.end.home }` query fails on any rename, which is the half that was worth keeping.

**There is a copyright footer, it is on ALL FIVE screens (four as of 2026-08-12, the welcome screen since
2026-09-18 — and a sixth, `ReplaceSessionPrompt`, since 2026-09-29, with the same `relative pb-20` contract), and the one omission is the decision.** `src/components/Footer.tsx` renders on **welcome,
landing, preparing, game and end**. There is
no shell to hang it on — every screen is its own `min-h-dvh justify-center` column, so one footer in
`App.tsx` or `main.tsx` is a sibling of a full-viewport column and gives every screen a permanent
scrollbar. **The game screen's old exclusion is still TRUE, it was OVERRULED**: that column is a
height budget (`--card-height` exists so the HUD, card, caption and controls fit a phone) and the
`pb-20` band costs it **56px more than the `p-6` it had**, so a short phone can now scroll mid-game —
accepted at the developer's request, and the lever if it hurts on a device is `--card-height`'s
`62dvh` term, **not** deleting the footer from that one screen. Still `absolute`, never `mt-auto`:
auto margins beat `justify-center` and the card would stop being centred. **Not the crash screen**:
`ErrorBoundary`'s fallback is a `role="alert"`, so its whole subtree is announced and the copyright
would be read out to someone being told the game crashed. **It is pinned to the bottom OUT OF FLOW
and that is a two-ended contract**: `Footer` is `absolute inset-x-0 bottom-8`, every host must carry
**`relative pb-20`**, and each screen's test asserts both (same shape as `card-ring` — the caller is
positioned). **THOSE TWO NUMBERS ARE ONE NUMBER SPLIT IN TWO** — 80px of band around a 32px offset and
a ~16px line is what puts equal air (32px) above and below the line, which is the symmetry asked for
on 2026-08-12; move one without the other and it is silently gone, because jsdom computes no layout.
The textbook `mt-auto` sticky footer is what this replaced and it cannot work here: **an auto margin
beats `justify-content`**, so the first `mt-auto` swallows the free space and the screen's content
stops being centred. Not `fixed` either — on the landing screen it would float over the suggestions
instead of ending the scroll. Two more traps. The `<footer>` is inside each `<main>`, so it is **not** a
`contentinfo` landmark and must not be given the role — and **Testing Library maps `footer` to
`contentinfo` regardless of ancestry**, so a role query cannot check any of this (a `toBeNull()` was
written first and failed against correct code). And its **"2026-present" is a year-shaped number on a
pre-reveal surface**: three leak proxies asserting `not.toMatch(/\b(19|20)\d{2}\b/)` caught it, and they
now subtract `COPYRIGHT_NOTICE` by exact string rather than loosening the pattern. **That string now lives in `src/game/copy.ts`** (re-exported from `Footer.tsx` for its importers), and since 2026-08-12 the author's name is a **bold `<a>`** inside the same line — `font-bold text-accent focus-visible:focus-ring`, `target="_blank" rel="noreferrer noopener"`, href from `COPY.footer.authorUrl`. It is the app's one use of the accent as TEXT (measured 5.13:1 on `--color-page`) and **was the app's only anchor until 2026-09-18**, when the welcome screen's PDF download became the second — both apply the everything-focusable-gets-a-focus-ring rule by hand, and the download also carries `touch-target`. The URL is deliberately **not part of `notice`** — that string is what the leak proxies subtract, and an `href` is not text a player reads. The three parts concatenate with **no separator**, so `<footer>`'s `textContent` is still the notice character for character; break that and the leak proxies fail on screens that have no leak. `getByText` cannot see it (its matcher reads only DIRECT text-node children), which is why `Footer.test.tsx` reads `textContent`.

## The card: faces, ring, QR, controls

**The neon ring is two `@utility` composites, not a component, and neither of them may declare `position`.** `card-ring` (both faces in `Card.tsx`) and `card-ring-dim` (the backs in `CardStack.tsx`) live in `src/index.css`. A `NeonRing` component was rejected because it would put a decorative `aria-hidden` node **inside the one subtree where "leak nothing" is a hard rule**, and give `prefers-reduced-motion` a second place to be taught about. The `position` rule is the live trap: `card-ring`'s gradient band is a `position: absolute` `::before`, so the reflex is `position: relative` on the utility — but **both call sites are already `absolute inset-0`**, the declarations would collide in one cascade layer, and if `relative` won, both card faces would drop out of absolute positioning and the card would come apart. The contract is _the caller is positioned_, pinned at both ends: `index.css.test.ts` asserts neither utility sets a `position`, and the component tests assert `absolute` beside the ring class. **The ring also does not animate** — that is deliberate, recorded in the CSS, and why the reduced-motion block still covers exactly three surfaces.

**Two Phase 8 findings that read as bugs and are not, plus one that is:**

- **The pre-`5e178f6` `public/logo.png` and the `logo.webp` that replaced it are DIFFERENT ARTWORK**, swapped in a single commit, which nothing recorded — Phase 7's note about replacing "a 1.26 MB PNG" is true about the bytes and silent about the picture. Resolved 2026-08-06 as **one identity everywhere**, then **re-resolved on 2026-08-12 against NEW developer-supplied artwork**: the master is now `visual-assets/logo-master/logo.png` (1254×1254, wordmark reading "PLAYLIST JITSTER"), and `logo.webp` (**384×384, 12,892 bytes**) plus all four PWA icons are `LANCZOS` downscales of it. **The master is deliberately in `visual-assets/logo-master/`, never `public/`** — everything in `public/` ships _and_ is precached by the service worker, and a 1.2 MB master there is the same file, at the same size, that cost 6.2 s of LCP as a favicon. **Never restore a large icon to the favicon slot** — that rule is unchanged. Every derivative also has its **black floor raised to `--color-page` (#0a0a0a)**, because the artwork's backdrop is pure black and the page is not: the logo is rendered on the landing screen at 192px and a 4% luminance step across a straight edge reads as a pasted square.
- **`--color-fg-year` is a separate token from `--color-ring-from` despite sharing its value**, and the year is **flat rather than the mockup's gradient**. `background-clip: text` needs `color: transparent`, so a gradient that fails to paint renders the year _invisible_ — the same silent shape as the unknown-colour-utility bug this repo already shipped — and a gradient has no single contrast ratio to record.
- **The deck's two peeking backs do not render at all on a full-height card**, and this one is a real defect: centre-origin `scale()` lifts the bottom edge by 8.96px while `translateY` pushes it down 10px, so they peek by 1.04px and 2.08px and are inset on every other side. Pre-existing from Phase 5, measured 2026-08-06, **not fixed** — the remedy is a deck-feel decision. Consequence: `card-ring-dim` is currently inert at desktop card sizes.

**The three controls are NOT on the card** (`src/components/CardControls.tsx`, rendered by `GameScreen` beside the stack), and putting them back would reintroduce a real bug: `gestureProps.onPointerUp` is bound to the card's outer element, so a pointer-up on a button inside the card is read as a tap and flips it — pressing Play revealed the answer. **Nothing interactive may be rendered inside `Card`.** Two tests assert the absence.

**`src/components/Spinner.tsx` exists for the `data-motion` hook, not for its four class names.**
Under `prefers-reduced-motion: reduce` the spinner is HIDDEN rather than stopped, keyed on
`data-motion="spinner"` in `src/index.css` — so a hand-rolled second copy is one typo away from an
element the rule does not match, and **nothing would fail**: jsdom evaluates no media query. Every
caller must keep saying everything the spinner conveys in the text beside it, because a
reduced-motion player sees no spinner at all. **There are now four, and the two added on 2026-08-11
are both inside a fixed-size box rather than free-standing**, because hiding a spinner that is the
only thing in its container leaves an EMPTY container: the Play button keeps its Play/Pause icon
rendered underneath the spinner, and the pending-year slot wraps it in a
`size-(--size-year-spinner)` box so the card does not change height on reveal. `Spinner` takes
`sizeClassName` and deliberately nothing else — a general `className` would let a caller pass
`animate-none` and re-open the drift the component exists to close.

**A seventh decision landed on 2026-08-06 and it reverses "the backs are empty divs", which was
written in three places: `CardStack` now renders ONE back, and it is the NEXT CARD'S HIDDEN FACE.**
The old shape was two empty divs, centre-scaled to 96% / 92% and offset 10px — and because
`scale()` is centre-origin, every edge was inset rather than peeking, so sliding the top card aside
uncovered two concentric rectangles smaller than the card. The back is now `absolute inset-0` with
**no transform**: covered pixel for pixel at rest, revealed complete the instant the card moves.
**The leak half of the old rule is untouched and still asserted** — the back mounts
`CardHiddenSide`, `CardStack` does not import `CardRevealSide`, and no title, artist or year reaches
the document a card early, in text or in an attribute. What does is the **track id**, because the QR
encodes it; that was weighed and accepted, and the cost half (one extra QR generation per advance)
is the feature rather than a side effect. Two consequences to know: `card-ring-dim` and
`--color-ring-dim` are **gone**, replaced by `card-ring-quiet`, which suppresses the back's bloom
through a **custom property** rather than a competing `box-shadow` (same cascade-order hazard the
ring's own comment refuses `position: relative` for); and **every DOM test file that renders a card
now needs `clearQrCache()` in its `beforeEach`**, because `src/game/qr-cache.ts` holds generated
codes at module level — Vitest isolates modules per file, not per test, and a warm cache turns a
placeholder assertion into a mystery failure. That cache is read **during render**, not in an
effect: `useEffect` runs after paint, so an effect would still show one frame of the placeholder and
the preload would buy nothing.

**THE CARD IS SQUARE as of 2026-08-11, and the ratio it replaced was measured into four other
numbers.** `--card-width` is now `var(--card-height)` with no multiplier — which is how
`index.css.test.ts` pins "square", because a `calc(... * 9 / 14)` passes a naive "derives from the
height" check while being the exact thing that was asked to change. **All three clamp terms moved with
it and none was free**: the clamp governs the HEIGHT, so under 9/14 every term was implicitly a width
term divided by 0.643. Floor `18rem → 15rem` (18rem of _width_ is 288px, and a 320px phone has 272px
once `<main>`'s `p-6` is paid), ceiling `28rem → 24rem` (area within 15% of the old 288 × 448),
`124vw → 80vw` (the same rule restated — 124vw of height _was_ 80vw of width once the ratio was
applied). **`--qr-display-size` went 14/18 → 7/12 → 3/4 in one day, and its binding constraint changed axis
twice**: a square face has width to spare but the code SHARED THE HEIGHT with the caption, so `p-6` +
`gap-6` + a 12px line took a fixed ~88px and 14/18 would have overflowed the floor card by ~35px —
which `overflow-hidden` **crops rather than shows**, i.e. a silently unscannable card. 7/12 kept the
displayed size at the 224px / ~140px it always was; then **the caption moved off the face** (below), the
vertical constraint vanished, and 3/4 is what the padding alone allows with a visible margin left —
**288px / 180px, and `QR_BITMAP_SIZE` had to follow 224 → 288**, because encoding below the displayed
size upscales a QR and blurs the module edges a camera reads. **That last rule died on 2026-09-29, when the
code became an SVG** (see the QR block below) — a vector has no resolution to fall short of.
`--ring-width` deliberately did **not** follow the card (a derived ring goes sub-pixel and blurs into
its own bloom). One new hazard: **`--container-content` and the card's ceiling are now both 24rem**, so
the three components capped at `--card-width` look mergeable with the reading measure — they agree at
the ceiling and nowhere else. Reasoning in [`docs/architecture.md`](./architecture.md) §3.

**The three controls are spaced against the CARD, and a `gap-*` on that row is a regression.** Also
2026-08-11, asked for as "bigger, with the same separation between them and the card's sides". `gap-3`
could not express it — it sets the two inner gaps and leaves the outer two to whatever centring a
hug-width row happened to produce, a number unrelated to the card. The row is `w-(--card-width)` with
**`justify-evenly`** (four equal parts of the leftover, so the rule holds by construction at every
viewport), and the size is **`max(3.5rem, calc(var(--card-width) / 5))`** so each gap is exactly
`card / 10` — half a button — at every card size, where a literal gives 42px gaps at the ceiling and
18px at the floor. `max()` not `clamp()`: the floor is what the buttons already measured, and `card / 5`
at the ceiling is 76.8px so an upper term would be unreachable. `--size-control-icon` (half the button)
and `--size-control-spinner` (`button - 1rem`, holding a constant 8px inset) are derived for the same
reason. `--size-touch-target` is still applied beside the size and still catches a lowered token.
`CardControls.test.tsx` asserts the row's width, `justify-evenly` and the **absence** of a `gap-*`.

**THE HIDDEN FACE IS NOW THE QR AND LITERALLY NOTHING ELSE (2026-08-11).** "Scan to play the full
song" is rendered by `GameScreen` BELOW the card, in `text-fg-muted`. Three things that buys, and the
first is why the QR could grow: the caption was the code's **ceiling** (it shared the card's height
with it); the sentence stopped being in the document **twice per card**, because `CardStack` mounts
`CardHiddenSide` again for the next card's back; and the dimming happens on the page rather than on a
card face. **The dimming is a TOKEN, never an `opacity-*` on `text-fg`** — `--color-fg-muted` is the
audited 6.12:1 on `--color-page` and an opacity modifier would drop it under the 4.5:1 floor with no
ratio recorded. It is rendered **unconditionally, including while flipped**: reproducing the face's
old disappear-on-flip with `{isFlipped ? null : …}` removes a line from a `justify-center` column, so
**the card would jump on every flip**. `CardHiddenSide.test.tsx` asserts the face has NO text at all,
and the silent-colour canary (this line once shipped as `text-text-muted` and rendered near-black on
near-black) moved to `GameScreen.test.tsx` with it.

**THE CARD'S QR IS AN SVG AS OF 2026-09-29, NOT A PNG — and `toDataURL` there is the edit to refuse.**
`QrCode.tsx` calls `qrcode`'s `toString({ type: 'svg' })` and wraps it in a `data:image/svg+xml`
URL. `toDataURL` draws onto a canvas and PNG-encodes on the main thread, and on the share-link route
that WAS the long task: the current card's code and `CardStack`'s preloaded back continue off one
`loadQrcode()` promise, so both ran in one microtask checkpoint — Lighthouse's ~970 ms task, almost
all of the route's ~620 ms TBT, and the route's LCP element. Measured and written up in
[`docs/review.unlighthouse.md`](./review.unlighthouse.md). Three things. **The PDF export still
uses `toDataURL` on purpose** (jsPDF embeds a raster), so it is not a second caller to "fix".
**Every test double for the card QR must mock `toString` explicitly**: an object mocked as
`{ toDataURL }` still has `Object.prototype.toString`, which returns `"[object Object]"` without
throwing — a garbage `src` and a green suite. `QrCode.test.tsx` pins the `type: 'svg'` option,
the one thing a double cannot see. And **the phone scan was done on the PNG**: a browser-rasterised
vector at a fractional module size is not what was scanned on 2026-08-05/06, so the scan is a row in
[`docs/development.md`](./development.md) §5 again.

**The deck-actions icon is the three-node share glyph as of 2026-08-11, and it is `filled` — so its
two link paths MUST carry `fill="none"`.** Otherwise the filled `<svg>` paints the triangle the four
link endpoints imply and the mark becomes a solid wedge. `filled` rather than the outlined default
because the reference's nodes are solid and three rings read as noise at 20px. The old export-arrow's
rationale is not wrong, it is answered — see the comment above `KeepDeckIcon`. `aria-label` is
unchanged ("Keep this deck"), and `CardControls.test.tsx` pins the shape counts and the `fill="none"`.

## Gestures and deck animation

**A LEFT SWIPE STEPS BACK ONE CARD AS OF 2026-09-18, A RIGHT SWIPE STILL ADVANCES, AND THE DECK IS NO
LONGER ONE-DIRECTIONAL — every sentence in `src/`, `README.md` and the top-level `docs/` that said it was
has been updated, so if you find one there, it is stale; `docs/plans/` records what was decided at the
time and was deliberately left alone.** The mapping is `swipeIntent(direction)` in `src/game/gestures.ts` — a pure function,
node-tested, because jsdom cannot exercise a drag and an inline mapping in the hook would be untested full
stop while turning every "next" into "previous" invisibly. `useCardGestures` gained `onPrevious` and
reads the intent; `CardStack` and `GameScreen` pass it through; **`PREVIOUS` is a reducer action** with
its tests, added exactly as `App.tsx`'s header says a fifth action must be, and `useGameSession` exposes
`previous` as its fifth callback. ArrowLeft is the keyboard's left swipe — it was **deliberately
unhandled** before, and `GameScreen.test.tsx`'s "should ignore ArrowLeft" became "should step back". Three
rules before touching any of it. **On card 1 `PREVIOUS` returns the SAME state object**: the hook has
already latched its commit, the reducer declines, Motion snaps the card back because its id did not
change — it never ends the session and never wraps to the last card. **The flip is reset, as `NEXT`
resets it**: `isFlipped` describes the current card and nothing remembers which earlier cards were
revealed, so carrying it over could hand a year to a player who never flipped that card; coming back to
one they did reveal costs a tap, which is the cheaper error. **Audio stops on a left swipe for free**,
because `GameScreen`'s stop rule is keyed on card id, not on direction — do not add a second stop. The
animation is DERIVED FROM THE INDEX DELTA as of 2026-09-19 (`deckMovementFor` in `gestures.ts`,
latched in `CardStack`) — which drag and keyboard both move, where before the direction was hook state
only a drag ever set, so every keyboard advance flew the "back" way.

**AND AS OF 2026-09-21 A STEP BACK PLAYS THE DEAL IN REVERSE RATHER THAN MIRRORING IT — the thing that
ANIMATES is the INCOMING card, which is why one delta now feeds TWO Motion channels.** The developer's
complaint was that left and right looked the same: both flew a card away and both simply had the next
one already sitting there, because `AnimatePresence initial={false}` meant nothing ever animated IN.
Forward is unchanged — the outgoing card flies to `+600` and uncovers the card beneath it. Backward is
the reverse of that picture: **the card you are returning to comes back from off the RIGHT edge**
and the card you are leaving settles to `x: 0` and drops UNDER it. (The distance is `600 → 0` for a
KEYBOARD step back; a dragged one starts wherever the thumb left it — see the finger block below,
which supersedes the `x: 600 → 0` this sentence used to state flatly.) Six things.
**`deckMovementFor` returns `'forward' | 'backward'`, not a `CommitDirection`**, and the rename is the
point: nothing moves left any more, so `'left'` would have been a lie kept alive by a type.
`CommitDirection` still exists and still belongs to `swipeDirection`/`swipeIntent`, which describe the
THUMB rather than the deck. **The exit reads `AnimatePresence custom` and the entrance reads a PLAIN PROP, and neither can
use the other's channel.** Exit must use `custom` because an exiting child animates with the props of
its last render and a keyboard advance changes the index and removes the card in the same render. Entry
must NOT: motion-dom hands `presenceContext.custom` to variant resolution only when `type === "exit"`,
and framer-motion's `makeLatestValues` resolves the first-paint inline style with no custom at all — so
a function `initial` reading presence custom paints one frame at rest and then jumps. `CardStack`
computes the movement once and hands the same value to both. **`initial={false}` does not block this**:
`<PresenceChild initial={!isInitialRender.current || initial}>`, so it silences only the session's first
card, which is the one that must not animate in. **BOTH EXIT BRANCHES NAME A Z-INDEX, AND THE
PARAGRAPH THAT USED TO STAND HERE SAID THE FORWARD ONE WAS FREE — IT WAS WRONG, AND THAT WAS THE
2026-09-21 SWIPE BUG.** The old reasoning was that `popLayout` absolutises the outgoing card and a
positioned element paints over in-flow content, so only the backward branch needed a `zIndex: -1`;
the forward one was "unchanged by construction" because the entering card's `animate={{ x: 0 }}`
resolves to `transform: none` and this app never registers `MotionGlobalConfig.WillChange`. Both of
those facts are true and both are beside the point: **the card's outer element carries
`perspective-distant`, and any `perspective` other than `none` establishes a stacking context** — so
the incoming card is painted in the SAME step as a positioned `z-index: 0`/`auto` sibling, decided on
TREE ORDER, and `AnimatePresence` splices the exiting child in BEFORE the present one
(`nextChildren.splice(i, 0, child)`). The incoming card won every tie, and a right-swiped card slid
out from UNDERNEATH its replacement: _"se va al fondo del mazo y sigue su movimiento a la derecha"_.
The forward exit is now `ABOVE_INCOMING_Z_INDEX` (1) — **strictly above 0, and strictly below the
peek's `z-10`** — and the backward one keeps `-1`, strictly below 0 and above the `-z-10` preload.
**Be precise about which branch the tie was hurting**: at `auto` the incoming card wins, so the
BACKWARD ordering was already falling the right way and `-1` only pins it against a splice order that
is not this repo's to keep; the FORWARD one is the branch that needed the tie to go the other way and
never got it. Neither may go back to a bare `0`. **This was
never about writing `0` down**: `0` and `auto` land in the same paint step, so the explicit value
that arrived with the backward branch changed nothing — the defect was latent for as long as the
flip has had a perspective on that element. Both are set with `transition: { zIndex: { type: false } }`
because the computed origin is the string `auto`. And **under reduced motion the card does not strand
off-screen**: motion-dom passes `{ type: false }` for positional keys, so `x` jumps 600 → 0.

The gesture has been felt by **no thumb**, and the reduced-motion jump has not been seen in a
browser: the manual rows are in [`docs/development.md`](./development.md) §5. The z-order during
the overlap is the one thing here that HAS been measured rather than reasoned — in headless
Chrome, against a four-element reduction of the deck, both before and after the fix. See
[`docs/agent_findings.md`](./agent_findings.md) (2026-09-21).

**AND THE TWO ANIMATIONS NOW RUN AT ONE SPEED RATHER THAN FOR ONE DURATION (2026-09-22), WHICH IS
WHY `EXIT_DURATION_S` IS NO LONGER "THE EXIT DURATION".** The developer's report: _"iguala la
velocidad de la animacion de swipe right con la de swipe left. la de swipe left es mas lenta y es la
correcta."_ Both ran for 250 ms, and that is precisely why they did not match — **equal TIME over
unequal DISTANCE is unequal SPEED.** A left swipe released at the commit threshold has ~192px left
to cover (the finger already dragged the first 96px of one 288px card); a right swipe has the whole
600px. Same quarter-second, ~3x the rate. So the left swipe's rate became the specification:
`TRAVEL_SPEED_PX_PER_S` is `(REFERENCE_CARD_WIDTH_PX - SWIPE_COMMIT_DISTANCE_PX) / EXIT_DURATION_S`
= **768 px/s**, and `TRAVEL_DURATION_S` is `EXIT_DISTANCE_PX` at that rate = **~781ms**. Four things.
**Nothing is written down — every figure is arithmetic over constants that already existed**, so
moving the threshold or the reference width moves the animation, and the lever if it reads as slow
motion on a device is the SPEED, not the duration. **`TRAVEL_DURATION_S` governs BOTH full-distance
journeys**: the forward exit and the KEYBOARD's backward entrance, which starts at the same 600px —
slow the throw alone and ArrowLeft becomes the fastest thing on screen, the same mismatch mirrored.
**`EXIT_DURATION_S` keeps its three short callers** — the backward exit's settle, the DRAGGED
backward entrance, and the copied `PEEK_RETURN_DURATION_S` — and the dragged entrance is the
reference, so changing it moves the target rather than just one animation. And **a left swipe
released further in is still slower than the threshold case**, because its shorter distance still
spends `EXIT_DURATION_S`; equalising that too would mean rewriting the animation the developer asked
to keep, so the threshold — the fastest the left swipe ever goes — is the conservative end of the
request. The cost is **~3x the old wall clock on every advance**, stated rather than discovered, and
felt by no thumb: row 9 in [`docs/development.md`](./development.md) §5.

**AND LATER ON 2026-09-21 THE STEP BACK STOPPED BEING AN ANIMATION THE RELEASE PLAYS AND BECAME ONE
THE FINGER PERFORMS — the current card no longer moves left AT ALL, and the thing that tracks the
thumb is the PREVIOUS card.** Two instructions, both literal. First: the card on top of the deck
"nunca pasara el limite izquierdo de su posicion inicial" — `dragElastic` was the scalar `0.35`,
easing the card past its constraints in both directions, and is now
`{ top: 0, right: 0.35, bottom: 0, left: 0 }` against the same `left: 0` constraint, so Motion clamps
AT the constraint going left while rightward travel keeps every bit of its old give. Second: every
pixel of leftward travel past that point moves the previous card in from the right instead, one for
one, and the release only finishes the journey. Eight things. **The peek parks ONE CARD-WIDTH out,
not at `EXIT_DISTANCE_PX`, and that number is measured rather than preferred**: a 360px phone renders
a 288px card inside `<main>`'s `p-6`, so a card parked at `x: 600` has its left edge 276px beyond the
right edge of the viewport — and the swipe commits at 96px, so the player would see nothing move at
all before releasing. 600 survives as the KEYBOARD entrance, where there is no finger and nothing on
screen to continue from. **`previousCardProgress(offsetX, cardWidth)` in `gestures.ts` is the whole
mapping** and it lives there for the usual reason: jsdom cannot exercise a drag, so an inline
division would be untested full stop. It reads Motion's POINTER offset, which is why a drag that goes
100px right and then 150px left engages the previous card by 50px — the developer's "puede deslizar a
la derecha y volver a dejarla en su posicion" falls out of it rather than being special-cased. **The
peek's position and its `display` are BOTH `MotionValue`s off one source**, because the alternative
to `display` is React state set from a per-frame drag handler, which is the one thing
`useCardGestures` refuses. It must be `display` and not `opacity` or `visibility`: those two leave
the element LAID OUT a card-width to the right of the deck, i.e. a permanent horizontal scroll on a
phone. **The card's width is read ONCE per gesture** from `deckRef.current.offsetWidth` at drag
start — `--card-width` is a `clamp()` so no constant could be right, and reading it per pointer move
would force a layout on every frame of the drag. **THE HANDOFF IS THE PART THAT BREAKS SILENTLY**:
at commit the hook reports `onPrevious(fromProgress)`, `CardStack` records it against the presence
key the returned-to card is ABOUT to render under, and `Card` spends it as `initial.x` — a percentage
of the card's own width, so it lands on exactly the pixels the peek was occupying. Drop it and the
card the player dragged a third of the way home jumps back off-screen and re-runs the entrance, which
is the seam the whole feature exists to remove. The record is **keyed, and spent in the same
render-phase guard that latches the movement** -- cleared on the first card change that is not the
one it names. Letting it merely go stale is NOT enough and that was a real bug: the presence key is
the same string every time the deck is on that card, so drag back to card 4, ArrowRight, ArrowLeft
would have brought card 4 in from the thumb's position two moves ago. An effect would be the
`set-state-in-effect` this repo's lint rejects, and nothing in jsdom can reach the sequence. **The peek is the LAST child
of the stack and carries `z-10`**, because the returning card has to land ON TOP — underneath, the
animation runs and looks like nothing at all, the same failure `BEHIND_INCOMING_Z_INDEX` prevents
from the outgoing card's side. It renders `CardHiddenSide` and the leak audit covers it exactly as it
covers the back. And **a `useTransform` output updates on Motion's frame loop, not inside the `.set()`
that invalidated it** (measured) — so a test against one needs `waitFor`. It is **not** a frame of lag
in the browser: `preRender` runs after `update` in the same frame and before `render`, and
`useCombineMotionValues` also recomputes synchronously during any React render, so the peek tracks the
finger and is already parked on the render a commit triggers. **`useCardGestures`
has tests for the first time** (`src/hooks/useCardGestures.test.ts`), and they assert CONFIGURATION
and callback payloads only — never a simulated drag, which would test the double. **Nothing here has
been felt by a thumb either**: rows 13–15 in [`docs/development.md`](./development.md) §5,
including the one known rough edge — the cancelled peek's slide-out is an imperative `animate()`, so
it does not read `MotionConfig reducedMotion="user"` and still slides under `reduce`.

## The game session: audio, exit, errors, the five 2026-08-05 decisions

**`src/components/ErrorBoundary.tsx` is the only class component in the app, and its fallback MUST NEVER render the caught error's message or stack.** `componentDidCatch` has no hook equivalent, which is why it is a class. It wraps `<App />` from **`main.tsx`, outside it** — a boundary catches only what is below it, so one rendered inside `App` would be unmounted by the very exception it exists to catch. The leak rule is the load-bearing part: every prop in the app flows through the tree it catches and the deck is in there, so an error string can quote a track title, artist or year. State holds a **boolean, not the `Error`**, so the leak is unavailable rather than merely avoided; the detail goes to `console.error`, which is not a rendered surface. **"Show the error so the player can report it" is the natural next change and it is the one that turns a crash screen into a spoiler** — `ErrorBoundary.test.tsx` throws an error containing a fixture card's title, artist and year and asserts all three are absent.

**An `ended` session with an EMPTY deck goes to the landing screen with a warning, not to the end screen.** A card whose FINAL year answer is null is removed from the deck while the session drops yearless cards (the default — "Deal cards with no year found" unticked), and since 2026-10-01 a final `low` card while it skips unconfirmed years, so a playlist the provider vote cannot place drains to zero; a session that drops neither never shrinks, so `deckCollapsed` can fire only on an empty deal and the check stays exact in every mode; that used to reach the end screen reading "Deck finished" over a count of **0**. `App.tsx` derives `deckCollapsed` from `status === 'ended' && deck.length === 0` — exact, because every other route to `ended` leaves the played cards in the deck — and checks it **before** `endedView`. The warning is `no-years-found`, which is why **`messages.ts` owns `StartFailureCode = PlaylistClientErrorCode | 'no-years-found'`**: the code is produced by the session, not by a fetch, and adding it to the client's own union would make that type claim a code `fetchPlaylist` cannot return. One slot, one union, no fifth view.

**A sixth developer decision landed on 2026-08-06, and it reverses a Phase 4 checkbox: the song
keeps playing when the card is FLIPPED.** Audio now stops on exactly two things — the card
changing, and a confirmed Exit. "Surely the preview should stop once the answer is on screen" is
Phase 4's own reasoning, it is the obvious thing to re-add, and **hearing the song while reading the
year is the point of the reveal** — a flip that killed the music turned the payoff into silence. The
other half of Phase 4's justification, a lingering preview bleeding into the next card, was already
covered in full by the **card-change rule** (keyed on card id, and also what makes a swipe stop the
audio), so `GameScreen`'s stop-on-flip effect and its `wasFlippedRef` were **deleted with nothing
put in their place**. `CardControls` is outside the card, so Play/Pause stays reachable during the
reveal for a player who does want silence. `GameScreen.test.tsx` asserts the **non**-stop, and
`useCardAudio`'s `stop` doc line no longer claims a flip calls it.

**Five developer decisions landed on 2026-08-05, after Phase 7 plan 1. Two of them reverse
something `plan.md` had already resolved, so read these before "fixing" the code back:**

- **A card whose year lookup finds nothing is REMOVED from the deck** (`gameReducer`, `YEAR_RESOLVED`)
  — **as of 2026-09-30, a card whose FINAL answer is null is removed, unless the session keeps yearless
  cards** (`GameState.keepYearless`, shown on the picker as "Deal cards with no year found" since 2026-10-01; see the options'
  block). A `resolve` that found nothing is not a final null: the card stays PENDING and goes to
  `verify`. This reverses `plan.md` §6's `confidence: 'none'` follow-on, which had it stay and play —
  and the option is the developer's way of asking for that follow-on back, per session. **Low
  confidence is unaffected** — it carries a real year. Consequences, with the option OFF: the deck
  shrinks on a real playlist (roughly a third before the provider vote), the card-1 gate is phrased
  as "the current card's answer is **final**" rather than "the resolved card was card 1" (with the
  option ON nothing gates at all), and all three entry points (`START`, `YEAR_RESOLVED`, `RESUME`)
  filter, so **no card in a live deck holds `year: null` — unless the session keeps yearless
  cards**, in which case a final null stays with `confidence: 'none'` and the index unchanged.
  `CardRevealSide`'s `none` branch ("Year unknown", "Check this one yourself") is therefore **LIVE
  again** for those sessions, and still covers pre-reversal saves.
- **The preparing screen shows no resolved/total count.** Also a reversal; `PreparingScreen` takes no
  count props. `resolvedCount` stays exported beside the reducer, with its tests, and no screen
  renders it — `pendingYearCount` is its complement.
- **Exit goes through a confirmation dialog** (`ExitConfirmDialog`, opened by `GameScreen`). While it is
  open `GameScreen`'s window key handler is disabled — that is guard 4, and it exists because → would
  otherwise deal a card behind the backdrop. **Since 2026-09-29 it has THREE answers**: Keep playing,
  **Restart game** (App's `handleRestart`, the end screen's "Play again": `state.deck` re-dealt with a
  fresh seed and the SESSION's `keepYearless`, card 1, and zero lookups for a card already final — a
  `yearProvisional` card rides the re-deal and still owes its verify) and End game. A restart usually leaves `GameScreen` MOUNTED
  (`playing → playing`), so `handleRestartConfirmed` closes the dialog and stops the audio by hand, and
  `CardStack` is keyed on `seed` so the jump to card 1 remounts it instead of playing the step-back
  entrance. The Tab trap is a three-button cycle.
- **The control bar's icons are inline SVG, not text glyphs**, sized from one token
  (`--size-control-icon`). ▶ and ❙❙ rendered at different weights and could resolve to an emoji font;
  nothing in CSS could equalise them. Exit is the emergency-exit pictogram in `--color-danger`.
- **`Card` accepts a `ref` and it is load-bearing**: `AnimatePresence mode="popLayout"` reaches the
  outgoing card through it, and silently does nothing without it — the incoming card was being laid out
  a full card-height below the outgoing one. See `docs/agent_findings.md`.

**The real-device pass was RUN on 2026-08-06, on Android, and it found exactly one defect: audio kept playing while the phone was locked.** `useCardAudio` now pauses on `visibilitychange` when `document.hidden` — which also covers switching apps and tabs. **Pause, not stop** (the position survives), and **no auto-resume** when the page becomes visible again. It lives in the hook rather than in `GameScreen` because it is a property of the DOCUMENT rather than of the card: no card changed. The leak rule was never breached — `navigator.mediaSession.metadata` has never been set, so the media panel could not name the track — but playing at all was wrong. Gestures, the flip-surviving audio and the on-screen QR scan all passed; **the five gesture constants were not retuned**, so they are now validated on one device rather than guesses. Writing the test for the fix exposed that `useCardAudio.test.ts` had **no `afterEach(cleanup)`**: a document-level listener is the first thing in a file capable of revealing that, and every earlier test acted only on its own element. Full results in [`docs/agent_findings.md`](./agent_findings.md) and [`docs/development.md`](./development.md) §5.

## Decks: playlists, selection, links, library, shuffle

**A DECK IS 1..5 PLAYLISTS AND BOTH PLANS ARE BUILT — plan 1 on 2026-08-07, plan 2 with it.** This
paragraph claimed until 2026-08-12 that plan 2 was unbuilt and that `App.tsx`, `DeckActions.tsx` and
`LandingScreen.tsx` carried `n = 1` **shims**; none of that is true and none of it has been for some
time. There are no shims (grep `shim` under `src/` — nothing), `usePlaylist.request(urls)` fans out
over up to five `fetchPlaylist` calls under **one** `AbortController`, `LandingScreen` is a list of
1..5 rows with a "+" and per-row errors, and `App.tsx`'s link effect submits **every** id a link
names. Only plan 2's own Documentation Updates were ever outstanding. Below React: `src/game/deck-merge.ts`
(the merge, the dedupe, the notice aggregation, the failure ordering, `deckLabel()` and
`MAX_DECK_PLAYLISTS`), `GameState.playlists` replacing `playlist`, both `localStorage` payloads at
**v2 reading v1**, the share link's `playlist` param as a **comma list**, and `SavedPlaylist.ids`
keyed by `savedDeckKey()`. **The merge lives in a pure module because a wrong dedupe or a wrong label
is invisible to every DOM test** — it reads as a duplicate card halfway through a deck, or as a
slightly odd heading. Three rules to know before touching any of it: **the v1 lifts on both storage
keys are load-bearing** (drop one and a deploy silently empties a curated library on the landing
screen), **the library caps its ids on read while a stored session deliberately does not** (the cap
governs INPUT; a saved session describes a deck that already exists), and **a link over the cap is
rejected, never truncated**. Full reasoning in
[`docs/architecture.md`](./architecture.md) §3, "The combined deck".

**HOLDING A SUGGESTED PLAYLIST SELECTS IT AS OF 2026-08-12, AND THE SELECTION IS DERIVED FROM THE
ROWS RATHER THAN STORED — that is the whole design, and a `Set` in component state is the change that
breaks it.** A suggestion is lit exactly when some form row parses to its id (via the shared
`parsePlaylistUrl`, so a `?si=` tail counts), which makes the row's ✕ **be** a deselect, makes a
hand-pasted link light the suggestion it names, and leaves no second copy of the truth to disagree
with the boxes on screen. The decisions are `src/game/playlist-selection.ts` — `selectedPlaylistIds`,
`planSelectionToggle` (returns an INSTRUCTION, so the module never touches row identity) and
`suggestionIntent` — all node-tested, because a wrong cap is a six-playlist deck and a wrong index is
a box that emptied itself, and neither is a rendering difference jsdom would notice. The binding is
`src/hooks/useLongPress.ts` and `src/components/SuggestionButton.tsx` (its own component only because
a hook cannot be called inside the `.map()`). **Nothing below React changed**: `onSubmit` has taken an
array since plan 2. Six things before editing any of it. **A press with NOTHING selected still deals a
deck immediately, replacing typed rows** — decision 5 unchanged, and the asymmetry the feature is
built on; the three ways to say "select instead" (the hold, a Ctrl/Cmd/Shift modifier, and "something
is already lit") are all explicit. **The modifier is the keyboard's ONLY route**, since a hold needs a
pointer. **Selection mode is scoped to the suggestions**, never "any parseable row" — the highlight is
the only cue for which of two things a press does, so a typed link must not silently change it.
**`LONG_PRESS_DURATION_MS` (500) sits beside `TAP_MAX_DURATION_MS` (400) in `gestures.ts` for the
invariant, not the topic**: it must stay above it, nothing compares them at runtime, and no rendering
would change if they crossed — a press would just satisfy both readings. **`consumeLongPress()` must
stay first in the button's `onClick`**, because `click` fires after `pointerup` and the swallowed
click is the one-line bug that would turn every hold into a single-playlist game. And the row's ✕ now
renders beside a **lone filled row** too (removing the last row substitutes a blank), without which
the first selection on a pristine screen would be the one the ✕ could not undo. `select-none`,
`touch-manipulation` and `[-webkit-touch-callout:none]` on the button are asserted by **nothing** — a
synthetic pointer cannot raise a platform text-selection callout, so that row is manual
([`docs/development.md`](./development.md) §5).

**Everything plan 2 built is a caller change: the reducer, `GameState` and the persistence format are untouched** — true of plan 2, and no longer of the link as a whole: the 2026-09-29 start card (block above) added `startCardId` to `START` and `startIndex` to `GameState` and the save. Three new pure modules in `src/game/` (`deck-link.ts`, `playlist-library.ts`, `pdf-sheet.ts` + `pdf-text.ts`), one new hook (`src/hooks/usePdfExport.ts`), and the shared `src/game/qrcode-loader.ts`. **Which subtree each landed in was the usual decision, and the rule is "put it where it can be tested":** `deck-link.ts` takes a query STRING rather than reading `location`, `playlist-library.ts` takes an injected `StorageLike` exactly as `persistence.ts` does, and `pdf-sheet.ts` holds every millimetre as arithmetic over numbers — the same decision/binding split as `gestures.ts` and `resolver.ts`, for the same reason: **getting the duplex column mirror wrong pairs every printed card with the wrong answer and is discoverable only by printing and cutting.** The binding halves are `App.tsx`, `EndScreen.tsx` and `usePdfExport.ts`. See [`docs/architecture.md`](./architecture.md) §3.

**THE SHUFFLE IS A HASH SORT AS OF 2026-09-29, AND THERE IS ONE ALGORITHM AND NO VERSION.** Implemented from
[`docs/review.shuffle-system.md`](./review.shuffle-system.md) §8, after the developer took all four decisions.
`shuffleDeck` in `shuffle.ts` orders cards by `hashSeed(seed + ':' + card.id)`, so the order depends only on the
SET of cards. That fixed the one real bug — a link copied after "Play again" never reproduced the deck, because
the seeded Fisher-Yates it replaced, re-applied to an already-shuffled input, is a different order — and it makes a
shared order survive a playlist gaining or losing a track. **For a few hours the same day both algorithms existed**,
with a `shuffleVersion` in `GameState`, the save and the link's `v` param; the developer then removed Fisher-Yates
and the whole version machinery (no saved games to protect), **accepting that a link minted before 2026-09-29 now
deals a different order**. So: **a `v` param is IGNORED, never rejected** (links minted in between carry `v=2`), a
save carrying a `shuffleVersion` field still loads, and **the output is pinned as literals in `shuffle.test.ts`** —
it is a stored format, a failing pin is fixed by reverting, and a future algorithm change has no lever left: it must
bring a version back, or accept the same re-deal knowingly. **A mid-game link
carries `&card=<trackId>`** and the recipient starts ON that card (`START.startCardId`; card 1 plus the
`startCardMissing` notice when the card is gone); the end screen's link does not, because its position is the
last card. So the card-1 gate is now "the CURRENT card's answer is **final**" (and only with "Keep cards with no
year found" OFF — with it ON nothing gates, see the option's block), the resolver crawls from the start card and
wraps, and `GameState.startIndex` (the lowest index this player has been on; saved, absent = 0) is what the end
screen's `cardsPlayed` subtracts. The copy-failed fallback `<input value>` beside an unflipped card now holds that
track id — the QR already encodes it, and the leak tests subtract it by exact string. **A link over a saved game is
decided by `linkArrivalIntent` in `deck-link.ts`, once, at mount**: `deal` when there is nothing to resume, `resume`
with NO prompt when the link describes the saved deck (same seed, every saved playlist named by the
link — a SUBSET check, so a recipient who lost one of five playlists still reloads silently; the card is never
compared, so the sender's position never moves a reloader), and `ask` otherwise, which renders
`ReplaceSessionPrompt` as its own branch before the status switch — never as an overlay, so no game screen, no
history entry and no audio is mounted under it. **"Play the shared deck" does not end the saved game**: the deal
effect's `start()` replaces it when the new deck lands, so a failed fetch leaves the prompt up with the error and
"Keep my game" intact. Declining is not remembered (the developer's choice), and after End or Exit a reload deals
the link again — the game no longer exists, and that re-deal is accepted. `generateSeed()` still runs inside
`START`; that impurity is known and accepted. Nothing here has been seen outside jsdom: rows in
[`docs/development.md`](./development.md) §5.

**A shared link promises "same playlist, same shuffle", NEVER "the same deck", and the copy is the feature.** Yearless cards are dropped at play time and editorial playlists refresh their tracks, so the seeded shuffle is exact while its input is not. The rule now lives as a comment on `COPY.deckActions.shareCaption`; the test that asserted the phrase "same deck" was absent went with the 2026-08-12 copy centralisation, because it is the one kind of assertion `COPY` cannot express. Also load-bearing: a link over a saved game is **asked about, never silently dealt and never silently ignored** (2026-09-29, see the block above), a malformed link is the plain **welcome** screen with **no error** (the front door since 2026-09-18 — with nothing to resume, `deckLink === null` is exactly what leaves the flag unseeded), and `App.tsx` **never touches the address bar** — no `pushState`, no `replaceState`. That rule is still true **of `App.tsx`** and is not the whole story any more: see the back-press block below, and do not delete the `pushState` in `useBackNavigation.ts` on the strength of this sentence. The link effect deliberately has **no "already submitted" ref**: such a guard survives StrictMode's simulated unmount, whose cleanup has already aborted the request it was recording, so the app would sit on the landing screen forever. That is measured and written up in [`docs/agent_findings.md`](./agent_findings.md) (2026-08-06).

**`playlist-library.ts` rebuilds an entry field by field on the WRITE as well as on the read, and that is a leak rule.** `SavedPlaylist` is a structural interface and TypeScript's excess-property check does not fire for a spread, so `savePlaylist(storage, { ...somethingLarger })` type-checked and wrote every extra field into a store the **landing screen** reads — a pre-start surface. Caught by the module's own leak test. **Validating only on read is not enough when the store itself is the leak surface.**

**THE SUGGESTED PLAYLISTS' YEARS ARE PRELOADED AS OF 2026-10-01, AND AN AGENT NEVER REFRESHES THE FILE ON ITS
OWN INITIATIVE.** `src/game/preloaded-years.json` holds, keyed by Spotify track id, the final answer of every
track of the suggested playlists; `applyPreloadedYears` (`src/game/preloaded-years.ts`) stamps it onto every
PENDING card of the merged deck in `usePlaylist`, so every deal of a fetched deck gets it. **The JSON is a dynamic
import** (`loadPreloadedYears`, fetched alongside the playlists, never rejecting): imported statically it took the
entry chunk from 226 kB to 395 kB. The resolver already treats a card that arrives with a final year as done, and
`START` already opens the card-1 gate for a final start card, so a preloaded deck starts at once and asks only for
the tracks the file does not know — which is what makes "the playlist changed since" free.

**The table is a cache asked before every request, on every path (2026-10-01, the developer's ask: "always the
first option, by track id; if found, settle the year and send nothing").** Restart, Play again and a resume never
pass through `usePlaylist`, so the stamp alone left a pending card from an older save, or a provisional one owed a
`verify`, going to `/api/year` for a track the file knows. `withPreloadedYears` (`preloaded-years.ts`) now wraps
the resolver's lookup in `use-game-session.ts`: a known id, at either stage, returns the table's answer as a FINAL
body (`cached: true`, no `source`) without calling the inner lookup; an unknown id goes through unchanged. The stamp
stays, because the gate is decided at `START`, before the resolver exists. `ResolverLookup` takes the `Card` (it
always passed one) so the wrapper can key on the id. The wrapper takes the table as a promise, so `off` applies and
`App.test.tsx`'s mock holds; `scripts/preload-years.ts` does not use it (it would read its own output). A card
already final is never asked, so a save's final answer is not overwritten. It applies to the same track in any
playlist, because a year belongs to the recording. A stamped card is final (no `yearProvisional`, no
`yearUnverified`) and, when it has a year, `high` (see the next paragraph), so `isDroppedAnswer` never drops it
for `skipUnconfirmed`; a preloaded `null` is still dropped unless the session keeps yearless cards. **The file is
generated by `pnpm preload-years`**
(`scripts/preload-years.ts`), which runs the browser's own `fetchPlaylist`, `lookupYear` and
`createYearResolver` against the real handlers in process — same vote, same Upstash gates and caches as
production — and keeps only answers returned `final: true` with no provider `skipped`; with no ids it re-reads
the playlists already in the file, it asks only for missing tracks unless `--refresh`, and it never overwrites an
entry with a `note`. **Manual entries are the developer's corrections** (soundtracks, film scores and anime
openings take the year of the film or season, not of the recording a provider found), each with a `note` and the
`providerYear` it replaced; the `note` is what marks one. **The developer decides when the file changes — a
regeneration or a correction is done only when they ask, or after asking them**: a refresh re-spends the shared
MusicBrainz budget for minutes and can overwrite years they reviewed. The chart rows (Top 50 Global, Éxitos
España, PEGAO, RapCaviar) churn weekly, so their part of the file ages fastest; that costs only requests, never a
wrong year. `preloaded-years.test.ts` fails when the file's playlists stop matching `SUGGESTED_PLAYLISTS`.

**Any year in the table is confirmed (2026-10-01, the developer's decision).** An entry is `{ title, artist, year:
number | null, note?, providerYear? }`: the `confidence` and `source` properties are gone from every entry, and a
numeric year is read as `high`. The developer reviewed the table, so a year in it is the answer; a provider vote's
"unconfirmed" describes how the vote went, not what the developer checked, and no longer applies. Consequences: the
97 entries that were `low` (final provider answers that were not confirmed) are now `high`, so their reveal never
shows "Unconfirmed year", and "Deal cards with an unconfirmed year" unticked (`skipUnconfirmed`) never drops a
preloaded year. A preloaded `null` (still allowed by the format; none exist today) is unchanged: dropped unless the
session keeps yearless cards. **The manual marker moved from `source: "manual"` to the presence of a `note`** —
a hand-added entry without a `note` is a provider entry, and a `--refresh` overwrites it. `pnpm preload-years` still
keeps only final answers with no provider skipped, a final `low` included, and that answer is read as `high`.

**`VITE_PRELOADED_YEARS=off` turns the table off, for load tests in production (2026-10-01).** With the preload on,
a suggested deck sends `/api/year` almost nothing, so the developer asked for a switch to put that traffic back.
`loadPreloadedYears` resolves to the empty table without fetching the chunk — exactly the behaviour before the
file existed — and `usePlaylist` is untouched. **Only the exact literal `off` disables it** (`isPreloadEnabled`):
unset, empty, `false` or a typo leave it on, because a mistyped value in the Vercel dashboard must never silently
cost every player the preload. It is a `VITE_` variable, so Vite **inlines it at build time**: flipping it is a
redeploy, not a runtime toggle, and a tab already open keeps its old build until the service worker updates (it
waits, it never skips waiting). A runtime switch (a URL parameter or a server-side flag) was not built. The server
caches (`mbyear:`, `yearprov:`) still answer tracks already resolved, so with the table off the load lands on the
year endpoint and Redis, and on the providers only for tracks the caches do not hold.

## Deck actions and the PDF export

**THE DECK'S PRINTED CARD IS 48.9722 mm IN A 4 × 4 GRID AS OF 2026-09-21, AND THAT REVERSES THE
2026-08-06 "65 mm = the real Hitster card" DECISION — narrowing it back is the edit to refuse.** The
developer asked for one thing: a card exported from a deck must be the same size, in the same place
on the page, as a card in the welcome screen's own `public/year-cards-1970-2033.pdf`. Two card sizes
on one table is the failure — a year card and a song card that do not stack — and the app ships both,
so matching a boxed game nobody in this flow owns was the weaker of the two targets. It is also the
only one this repo can CHECK: the template is a committed file that can be measured, where 65 mm was
a remembered number. **Every figure was read out of the template's content streams**, not guessed:
`n 20 559.7638 138.8189 138.8189 re S` is its first slot, so the card is 138.8189 pt = **48.9722 mm**,
the four column origins are 20 / 158.8189 / 297.6378 / 436.4567 pt and the four row origins
559.7638 / 420.9449 / 282.126 / 143.3071 pt (PDF measures from the BOTTOM) — centred on both axes.
The decode procedure is in [`docs/agent_findings.md`](./agent_findings.md) (2026-09-21) and the
one trap is that the streams are **ASCII85 then Flate**, so `zlib.decompress` alone fails with
`incorrect header check`. Eight things to know. **`CARD_SIZE_MM` is DERIVED, never written down** —
`(PAGE_WIDTH_MM - 2 * SHEET_MARGIN_X_MM) / GRID_COLUMNS` off the template's flat 20 pt margin, so the
card cannot disagree with the margin it sits inside; `MARGIN_X_MM` comes back out at that same
7.0556 mm, which is what makes the derivation consistent rather than circular. **The duplex mirror
and `planSheets`' interleaving did NOT change**: the mirror still works because the grid is still
centred, and `xFront + xBack === PAGE_WIDTH_MM - CARD_SIZE_MM` is still what the test asserts rather
than four literal positions. **The template is NOT a per-sheet duplex interleave** — its ten pages are
eight year fronts then two pages of a repeated decorative back — and copying that page ORDER would
pair every printed card with the wrong answer; size and position were the request, pagination was
not. **`backLayout()` is new and it exists because the back's type was the real bug**: `drawBack` held
`+28`, `+40`, `-12` and `* 5 + 2` as 65 mm literals, and on a 49 mm card the artist baseline lands
past the cut — so every millimetre moved into `pdf-sheet.ts` as the hook's header had always claimed
it was. The year now copies the template exactly (**Helvetica-BOLD 28 pt, baseline 10 pt below the
card's centre**); title and artist scale by `TYPE_SCALE`. **The gaps are 1.7 and 0.9 title
line-heights and they are not round numbers**: the binding constraint is that the artist's CAP height
clears the last title line's DESCENDER, a collision a "fits inside the card" test passes straight
through — it is 0.70 mm at these values, with 2.24 mm of slack to the cut, and both are asserted.
And **`CARD_PADDING_MM` scaled with the card rather than staying at 6 mm**, because 6 mm on a 49 mm
card is 12.3% a side where it was 9.2%: the code would have shrunk 30% while the card shrank 25%.
**One user-facing string reaches into the geometry**: `COPY.deckActions.sheetSummary` imports
`CARDS_PER_SHEET`, the only import in `copy.ts`, because "12 cards each" was a hand-written number
that nothing — not the typecheck, not a test asserting against `COPY.*` — could have caught going
stale. **Nothing about any of this has been printed.** The cut, the duplex alignment and a scan at the
new 39.93 mm symbol are rows in [`docs/development.md`](./development.md) §5.

**THE PDF EXPORT HAS "LEAVE UNCONFIRMED YEARS BLANK" AS OF 2026-10-01** (`COPY.deckActions.blankUnconfirmed`,
the developer's wording): ticked, a card whose final year is `low` is printed with its title and artist and
NO year — the same blank a kept yearless card prints with — for the player to write in. It changes what is
DRAWN, never which cards are printed, so the sheet count is the same either way. The decision is the pure
`printedYear(card, { blankUnconfirmed })` in `pdf-sheet.ts`; `drawBack` only skips the year's `text` call
when it answers `null`. **Local state in `DeckActions`, default OFF and NOT remembered** — a choice about
the next file, not about the game, so it resets when the panel closes — passed per call to `exportDeck`,
including the wait's auto-export and "Print so far". **It lives in the PRINT VIEW, and Print now
ALWAYS opens that view** (the developer's choice, later on 2026-10-01): the option was asked to sit
beside "Print so far", but the wait is reached only while years are pending, so on a resolved deck it
would have been unreachable. So `DeckActions`' Print opens "Print this deck" (`COPY.deckActions.printTitle`)
— the sheet count (resolved) or the wait (pending), the option, one press that exports (Print, or
"Print so far" while waiting) and Cancel — and a resolved deck now costs one more press than before.
The pending case behaves as it did: opening the view is the press that starts the wait, and the wait
still exports by itself when the last year lands, then turns into the resolved view in place.
**The title changes for that view only**: the dialog stays "Keep this deck" over the three actions. The
view is `DeckActions`' state and the heading is the host's element, so the host passes
`renderHeading(view)` and `DeckActions` renders it first, in a fragment — the dialog's `<h2>` (still the
one `aria-labelledby` names) and the end screen's section heading both follow it. Focus goes to Cancel on
the way in and back to Print on the way out. The checkbox is an `<input>`, so it is in the dialog's Tab
cycle inside the print view (`FOCUSABLE` already names inputs). **It is NOT offered when the session
skips unconfirmed years** (`state.skipUnconfirmed`, threaded beside `keepYearless` to `DeckActions`;
the developer's call): that session has already dropped every final `low` card, so the box could
change nothing.

**An eighth decision landed on 2026-08-06 and it reverses half of plan 2's decision 7: the share
link, the save and the PDF export are reachable MID-GAME.** They were on the end screen and
**nowhere else**, and the objection that reversed it is that reaching the end screen means **ending
the game**, which is irreversible — so the price of copying a share link was the deck. Decision 7's
two reasons for keeping them off the game screen are _answered_, not waived: the spoiler half by
`DeckActions` rendering **only counts** (asserted against the whole fixture deck, attributes
included), and the swipe half by mounting it in `DeckActionsDialog` — a modal whose backdrop takes
the pointer while **guard 4 in `GameScreen` suspends the window key handler**, exactly as
`ExitConfirmDialog` already did. Three things to know before editing any of it: **`DeckActions` is
shared by both screens**, so a change to the copy or the buttons lands in two places at once and its
tests live once, in `DeckActions.test.tsx`; **guard 4 is now an OR over two flags** and a third
dialog must be added to it; and **`CardControls` gained a button**, which is why its
`aria-label` list is asserted exactly (now `['Exit game', 'Play', 'Keep this deck']`, since Restart
was removed on 2026-08-11) — the
bar is a leak surface beside an unflipped card, and "Keep this deck" is safe because it names the
deck rather than the card. The cost is measured: **+4.8 kB gzip on the initial path**, because
`DeckActions` becomes a shared chunk instead of living inside `index`.

**The PDF export WAITS for the year crawl; the share link and the save do not** (2026-08-07). The
asymmetry is the design, not an inconsistency: a link is (playlist id + seed) and a save is
(id + name), both complete the moment a deck exists — **the PDF is the one artefact that is finished
when it is made**, and `selectPrintableCards` drops every card without a FINAL year, so an export taken
mid-crawl prints a deck that is quietly short and the omission is discoverable only by counting
printed paper. So a press with lookups outstanding neither exports nor refuses: it shows a
preparing-screen-shaped wait and exports itself when the last year lands. Three traps. **The wait is
DERIVED (`hasAskedToPrint && pendingYearCount > 0`), never stored** — the obvious `isWaiting` flag
cleared by an effect is what `react-hooks/set-state-in-effect` rejects, and the rule is right, so
the wait ends by itself on the render where the count hits zero. **The auto-export effect still
needs `hasAutoExportedRef`**, because `hasAskedToPrint` stays true after the handoff and `deck` is a
new array identity on every resolved year. And **`excludedCount` / `nothing-to-print` are still live
branches**. Since 2026-09-30 the gate waits for `year === undefined` **and for provisional** —
`pendingYearCount` counts a `yearProvisional` card as pending, because a printed year must be one the
`verify` stage can no longer correct — and `selectPrintableCards(deck, { keepYearless })` leaves
provisional cards out and COUNTS them in every export, **"Print so far" included** (the developer's
decision: nothing on paper can still change). A `year === null` card is the option's call: with
`keepYearless` ON ("Deal cards with no year found" ticked) it is printed with its title and artist in their usual places and
the year area **left blank** to write in by hand (`drawBack` skips only the year's `text` call — no
box, no line, `backLayout()` and the print palette untouched); with it OFF it is dropped, and only a
resumed pre-reversal save holds one. `options` is required, so no caller can forget to decide the
null rule. Since 2026-10-01 a final `low` year can be printed blank the same way, per export, with the
dialog's "Leave unconfirmed years blank" (`printedYear` in `pdf-sheet.ts`; see the options' block).
`pendingYearCount` is a selector beside the reducer and is the first caller
`resolvedCount` has had since 2026-08-05.

**The wait offers "Print so far", and it does not contradict the gate — it is the gate's informed
version** (2026-08-07). What the gate refuses is a deck that is **quietly** short; a player who
presses this is told the count that was left out, in "PDF downloaded — N cards left out, no year yet"
(since 2026-09-30 that N also counts cards whose year is shown but still provisional).
**That line is now the whole of the disclosure** — an explanatory caption above the buttons was
written and then cut as noise, so do not weaken the message. Three things to know. It does **not touch
`hasAskedToPrint`**, so the wait survives its own export and the complete deck still arrives by
itself — **two files, both asked for**, which is the behaviour, not a double-export bug. **`role="status"`
moved off the wait's outer div onto the two sentences inside it**, because the button's label counts
codes as they are generated and a count climbing inside a live region is a hundred announcements; the
buttons and the outcome now sit outside it, and the outcome brings the separate region it already
had. And **focus still lands on Cancel rather than on the new first action**, against the dialog's own
convention, because an Enter pressed reflexively on arrival should not spend paper. The outcome
paragraph is now the shared `ExportMessage`, so the two views cannot describe one `PdfExportState` in
two different sets of words. Its happy path is finally testable: `DeckActions.test.tsx` doubles both
`qrcode` and `jspdf` — before this, every export test stopped at `nothing-to-print`, the one outcome
reached before either dynamic import.

## Deal options

**THE PICKER HAS TWO DEAL OPTIONS AS OF 2026-10-01, AND BOTH DEAL WHEN TICKED: "DEAL CARDS WITH NO YEAR
FOUND" (UNCHECKED BY DEFAULT) AND "DEAL CARDS WITH AN UNCONFIRMED YEAR" (CHECKED BY DEFAULT).** The labels
moved twice that day, at the developer's request: in the morning the pair read "Skip cards with no year
found" / "Skip cards with an unconfirmed year" and skipped when ticked; by the afternoon they read
"Deal …" (Spanish "Repartir cartas sin año" / "Repartir cartas con año no confirmado") and deal when
ticked. The first is the 2026-09-30 **"Keep cards with no year found"**
([`plan.year-fetch-rework-ui.md`](./plans/plan.year-fetch-rework-ui.md), spike §12.8) under a new
label and its original polarity; its hint ("useful to print the whole deck…") was deleted with
`COPY.landing.keepYearlessHint` and the `aria-describedby`. **The model never inverted**:
`GameState.keepYearless`, `GameState.skipUnconfirmed`, the save and `prefs.ts` kept their polarity
through both relabels, so no stored value changed meaning and the default behaviour (drop yearless
cards, deal unconfirmed ones) never changed — which is why the second box reads CHECKED on a fresh
profile. **The one inversion is in `App.tsx`** (`dealUnconfirmed={!skipUnconfirmed}`;
`dealYearless={keepYearless}` is straight); `LandingScreen` takes `dealYearless` / `dealUnconfirmed`
so its props read like its labels. "Fixing" the polarity by renaming the stored fields is a
save-format change for no behaviour, and is the edit to refuse. The second option is **`GameState.skipUnconfirmed`**, built
exactly like `keepYearless`: required on `START` and in `GameState`, optional in the save (absent =
`false`, no version bump), and remembered in the same prefs record. Both boxes are `OptionCheckbox`
(`src/components/OptionCheckbox.tsx`) inside one bordered group — a native checkbox with
`appearance-none` and a painted tick, shared with the PDF option below.

What the two decide, per session. **`keepYearless` ON** (yearless box ticked): a card whose final answer
is null STAYS, with `confidence: 'none'`, plays as "Year unknown", and the PDF prints it with the year area
blank. **`skipUnconfirmed` ON**: a card whose FINAL answer is a year at `low` — one no second provider
confirmed, which the reveal labels "Unconfirmed year" (the unconfirmed box UNticked) — is REMOVED, by the same rule, at the same three
entry points (`START`, `YEAR_RESOLVED`, `RESUME`) and with the same index arithmetic as a final null. Both
rules are ONE function, `isDroppedAnswer` in `reducer.ts`. **The gate is skipped only when the session can
drop NOTHING** (`keepYearless && !skipUnconfirmed`): with `skipUnconfirmed` the start card's provisional
year may still settle at `low`, so `keepYearless` alone no longer goes straight to `playing`. Seven things.

- **A PROVISIONAL year is never dropped by `skipUnconfirmed`**, and `isDroppedAnswer`'s
  `yearProvisional` check is load-bearing: a provisional year is ALWAYS `low`, and Restart re-deals
  `state.deck` through `START`, so a confidence-only filter would delete every card still awaiting
  `verify` on a restart. A final null is not "unconfirmed" either — the two options are independent.
- **Remembered per viewer under `jitster:prefs:v1`** by the pure `src/game/prefs.ts`, built exactly
  like `locale.ts`: an injected `StorageLike`, a new never-renamed key, **validated on read PER FIELD**
  (anything not a JSON object reads as the default; inside one, each non-boolean field reads as ITS
  default — so a pre-2026-10-01 record holding only `keepYearless` keeps it rather than resetting for
  lacking the newer key), and **rebuilt field by field on write** — the `playlist-library.ts` leak rule.
  `App.tsx` holds the whole record in one lazily-seeded `useState` and writes both fields on every change.
- **Which value a deal uses is the part to get right.** Every NEW deal — the picker's Start, a share
  link's deal effect, "Play the shared deck" — takes the **recipient's remembered preferences**; Restart
  and "Play again" take the **session's** `state.keepYearless` / `state.skipUnconfirmed`, never the
  boxes' current state; a resumed game takes its save's. **The link format is unchanged and never
  carries the sender's choice**, and `linkArrivalIntent` does not look at it.
- **The PDF export reads the SESSION's `keepYearless`**, threaded as a plain prop from `App.tsx` through
  `GameScreen` → `DeckActionsDialog` and `EndScreen` into `DeckActions` → `usePdfExport` →
  `selectPrintableCards`. `skipUnconfirmed` needs no PDF rule: its cards are already out of the deck.
- **The residual is accepted, and nothing is built for it**: a later card whose verify comes back null
  (option OFF), or `low` (with `skipUnconfirmed`), is dropped from under the player — even a revealed one,
  since `low` is common enough that this will be SEEN. Keeping a card once the player has reached it is
  out of scope, not forgotten. A deck drained to zero by `skipUnconfirmed` reads the `no-years-found`
  warning, which is close enough to true.
- **The markup's traps are pinned in `OptionCheckbox`'s header.** `touch-target` is on the `<label>`
  (the press area); `focus-visible:focus-ring` is on the input, which is also the painted box; `text-sm` is
  on the caption `<span>`, not the label — the 2026-09-21 preflight trap; no `aria-label` (the caption is
  the name, WCAG 2.5.3) and no `value`, because the leak audit reads `value`. The caption is
  `text-fg-secondary`, the picker's other captions' colour, at the developer's request — `text-fg` read
  brighter than everything around it.
- **Nothing about it has been seen outside jsdom** — the restyled boxes at 320px, a printed blank year and a
  screen reader over a provisional-to-final change are rows in [`docs/development.md`](./development.md)
  §5, beside plan 4's step 10 preview checks.

## Year resolution: MusicBrainz

**`Single` and `EP` COUNT toward a `high` year as of 2026-08-11, and that reverses Phase 2's
`primary-type: Album` rule — narrowing it back is the one edit that reintroduces the bug.** A release
group's `first-release-date` is the date of the RECORD, so an Album-only filter answers "when was
this track first put on an album", which is not the question the game asks: Creep read 1993 (single
1992-09, _Pablo Honey_ 1993-02), Mr. Brightside read 2004, and a song never issued on a studio album
had **no eligible release group at all** and fell through to the unfiltered pass ("Hey Jude").
**Widening cannot overshoot, and that is the whole safety argument**: earliest-wins runs after the
filter, so more release groups can only move the answer earlier — Billie Jean keeps 1982 despite its
January **1983** single, asserted rather than assumed. The same change replaced `mode:
'strict' | 'relaxed'` with a three-rung ladder (`YEAR_TIER_ORDER`, walked by `resolve-year.ts`),
because the old relaxed pass applied **no release-group filter whatsoever** — live takes,
compilations and bootlegs were as eligible as the original, which is why `low` answers were so often
wrong. The new middle rung keeps the secondary-type exclusion and relaxes only the primary type and
the `Official` status. **The ladder is free**: all three rungs are pure functions over the same
already-fetched pool, so a lookup still costs exactly two MusicBrainz requests. Four things to know
before touching any of it. **`isOfficialStudioAlbum` is now `isOfficialOriginalRelease`** and is
still the one predicate shared with `api/_lib/musicbrainz.ts`. **The 50-id cap on request 2 now sorts
Album → EP → Single before truncating**, which is what makes the widening non-regressive by
construction. **`YEAR_CACHE_SCHEMA_VERSION` is `v6`** — it went to `v4` with this change, necessarily
rather than ceremonially, because the change altered answers cached at `high` for 30 days, to `v5`
with the fixes below, and to `v6` on 2026-10-01 with the query-ladder reorder below, necessarily
again: a card that used to stop at the unbounded full-artist query now stops at the guess, so its
cached answer changes (Get Lucky was cached at 2021 `low` and now reads 2013 `high`). And **all 22 fixtures were RE-CAPTURED**, because the
old ones carried Single candidates with no `releaseGroupFirstReleaseDate` (nothing had ever fetched
one) — so the 14-track suite passed both before and after the code change while being structurally
incapable of testing it. Measured 21 of 22 exact live. **Since 2026-09-30 that `high` is ONE VOTER,
not the card's answer** (the provider-vote block below): on the staged `/api/year` a MusicBrainz
`high` is confirmed only when a second provider agrees, and alone it is kept as the strongest
UNCONFIRMED answer — `low` on the wire. Everything above is still true of MusicBrainz's own scorer
and of the stage-less legacy path, which returns the ladder's answer as it always did.

**AND AS OF 2026-09-30 THE CLEANER READS THE LAST TRAILING SEGMENT FIRST, AND AS OF 2026-10-01 THE
QUERY LADDER ASKS THE ARTIST GUESS BEFORE THE UNBOUNDED FULL ARTIST** ([`plan.year-fetch-rework-mb-fixes.md`](./plans/plan.year-fetch-rework-mb-fixes.md)).
Three things. **`TRAILING_SEGMENT_PATTERN` had a lazy head**, so `X (REMIX) (feat. Y)` was read as one
unclassifiable segment and left whole; the head is now greedy, so the LAST segment is examined first,
and when that segment is unrecognised `cleanTrackTitle` retries with the old lazy pattern — so it
**never strips less than it used to**, by construction (`Song - Live at Wembley - 1986` and nested
brackets are the two cases that need the fallback). **The recording-query ladder is THREE rungs
as of 2026-10-01, and the primary-artist guess comes BEFORE the unbounded full-artist query:
`duration-bounded` (full artist, `dur:` bound) → `artist-guess` (no bound, only when the guess
differs from the full string) → `unbounded` (full artist).** Each runs only when the one before
returned nothing, so a first-try card still costs exactly two requests. The `tokenised` rung that
plan 1 built on 2026-09-30 is **gone**, from the primary ladder and the remix fallback, and its `low`
cap in `resolve-year.ts` with it: over 782 live cards it answered 5, all five already answered by
Deezer, and rescued 0 inside the remix fallback. **Putting the full-artist unbounded query back
before the guess is the edit to refuse**, and it is the order Phase 2 chose (its decision 15) and
this block used to describe: in the spike baseline the guess found a year for **68%** of the cards
that reached it (108 of 159) against **5%** for the unbounded full string (11 of 235), because
Spotify's `", "` join rarely matches MusicBrainz's joinphrase. The reorder cut MusicBrainz requests by
**15.7%** (2.735 → 2.306 per card), lost 3 MusicBrainz years that Deezer already had (0 shown years
changed under the vote), and moved 5: four to the right year (Get Lucky ×2, Up Where We Belong,
You're The One That I Want) and one wrong both ways, an artist-matcher defect (Somebody That I Used
To Know, open). **The cost is known and accepted**: on a comma-in-name artist with no duration, or
whose bounded query misses, the lossy guess is asked before the full name is asked unbounded. A 13-artist probe found
**one** wrong year from it — "Teach Your Children" (Crosby, Stills, Nash & Young) 1970 → 1969, via a
Crosby, Stills & Nash recording the exact matcher admits. That replaces the old "Earth, Wind & Fire"
argument for keeping the guess last: the band resolves correctly in both orders, and the feared
steal (a non-empty guess pool that scores no year) happened 0 times in 782. A duration-bounded guess
was measured and rejected (6 lost, 9 moved, and one real steal, The Imperial March). Full tables in
[`docs/agent_findings.md`](./agent_findings.md) (2026-10-01). And **a failed release-group request, or a busy gate before it, is now `upstream-unavailable`, never a
silent degrade** to the lower rungs — that used to cache a `low` year drawn from reissue dates on a
card that would have been `high` a second later. It is deliberately not `rate-limited`: the client
treats a 429 as free and would re-spend request 1 in a loop. **As of 2026-10-01 the same rule covers
EVERY permit after the lookup's first request** — query rungs 2–3, the release-group request and the
remix fallback's first query all run only after something was spent, so they wait up to ~3.5 s
(`SPENT_LOOKUP_MAX_WAIT_MS`, about three other lookups queued ahead at the gate's 1.1 s spacing)
and, if still refused, return `upstream-unavailable`. Only query 1 keeps the gate's 1.5 s default and
the free 429, because nothing is spent yet. The longer wait is a named exception to `rate-limit.ts`'s
"never wait long inside a function" rule, paid in idle function time only on a cold card whose first
query missed under contention (how often is unmeasured), and it buys the uncontended answer without a
restart from query 1. **Returning `rate-limited` after a spent request is the edit to refuse.**

**The twenty-second track is pinned as WRONG on purpose, and it is not a filtering problem.**
`YEAR_LIMITATION_FIXTURES` holds "Personal Jesus" at ground truth 1989 with `resolvesTo: 1990`
asserted. Year resolution is **recording**-scoped — the adapter finds recordings, then asks which
release groups they appear on — and the album version is 4:55 while the correctly-dated 1989 single
carries a **3:46 edit**, a separate recording MBID. Verified unbounded: the `dur:` bound is not what
hides it, and removing the bound would not help. Reaching it needs **work-level** resolution, which
is a much larger change. If you are about to "fix" this by loosening a filter, you are reasoning
about the wrong entity. See [`docs/plans/plan.year-accuracy.md`](./plans/plan.year-accuracy.md).

**CONFIDENCE IS THE WEAKEST OF TWO AXES, NOT THE RUNG ALONE (2026-08-11), which is why
`YearTier.confidence` is called `maxConfidence` — it is a CEILING.** The artist filter sits outside
the ladder (same pool on all three rungs) and has two strengths: the exact rule that has always been
there, and — **only when the exact rule admits NOTHING** — a loose one, the same tokens in any order
with at most one word of slack. A loosened match caps the answer at `low` however good the rung was,
computed by `weakest()` at `pickBestRecording`'s single success return. **It is a fallback, never a
widening, and merging the two rules into one filter is the change that breaks it**: earliest-wins
would hand the answer to any loosely-matched candidate with an older date, and `preferByDuration` is
**not monotone** (it narrows to length-matching candidates only when that set is non-empty, so one
admission can collapse the pool to just it) — so a union can move a year in **both** directions. The
fallback shape provably cannot: exact pool non-empty → bit-identical to before; exact pool empty →
every rung already returned `no-candidates` and the card was **dropped from the deck**. It can only
turn a null into a year. `year.test.ts` pins that with a two-candidate exact-1994/loose-1984 case.
**Both halves of that argument are about MusicBrainz's OWN answer, and since 2026-09-30 that answer is
one vote among three** (the provider-vote block below): a MusicBrainz null no longer drops a card on
the staged path, it only leaves the vote to Deezer and iTunes, and a MusicBrainz `high` is no longer
final alone. **The ceiling also does a second job now**: `UNCONFIRMED_TRUST` ranks MusicBrainz twice,
`high` above iTunes and `low` below it, so a loose-artist hit capped at `low` also
drops BELOW a lone iTunes year when nobody agrees. That is the cap working as intended — looser
evidence ranks lower — not a regression to fix by raising it.
**Why it exists**: Spotify joins collaborators with `", "` and MusicBrainz uses a joinphrase, so they
disagree about the connector _and_ the order — measured 5 of 18 failures across two real 50-track
playlists. **Note what it is NOT**: `normalizeForCacheKey` already maps `&`, `+` and `,` to spaces, so
punctuation-only differences always matched; only word connectors and reordering were broken. The
cheaper "normalise join words, keep contiguity" fix was measured and **rejected at 2 of 4**, because
half the real sample is pure reordering (`Xavi, De La Rose` vs `De La Rose & Xavi`). Three more
things: the loose rule is deliberately **stingy** (≥2 non-article tokens on the shorter side, ≤1 word
of slack) because it fires exactly when the artist is unrecognisable, and a false positive puts a
plausible **wrong** year on a card whose whole content is the year; it is **order-blind** by
construction (`Alice Cooper` ~ `Cooper Alice`), pinned as a test rather than pretended away; and
**`artistMatchesExact` is exported only for one test** — the guard asserting no accuracy fixture ever
reaches the loose pass, which is what makes the safety argument a test instead of a claim. **The
accuracy suite cannot check any of this**: the fixtures were trimmed keeping representatives of
distinct exclusion reasons and "excluded by artist" was never one of them, so `pnpm test` passes
identically with the artist rule reverted. Same false-comfort shape as the pre-2026-08-11 fixtures.

## Year resolution: the provider vote

**A CARD'S YEAR IS A VOTE OF THREE PROVIDERS AS OF 2026-09-30, AND MUSICBRAINZ IS ONE VOTER IN IT —
TWO AGREEING PROVIDERS CONFIRM A YEAR, AND NOTHING MORE IS ASKED**
([`plan.year-fetch-rework-server.md`](./plans/plan.year-fetch-rework-server.md)). The order is
two constants in `shared/year-providers.ts` and nothing else. `YEAR_PROVIDER_PLAN` asks **Deezer**
(fast: ~2 requests and ~0.25 s a card) **in parallel with MusicBrainz** (coverage: the only source
whose date means "first release" on old catalogue) at `stage=resolve`, then **iTunes** (precision:
19/19 fixtures, but ~20 requests a minute for the whole app) at `stage=verify`. `UNCONFIRMED_TRUST`
says whose lone year is kept when nobody agrees. **The parallel pair is wired nowhere** — it falls
out of `nextFrontier`'s "no usable answer yet, ask the next two" rule — so a reorder is an edit to
those two lists plus the `Record<YearProviderId, ProviderLookup>` registry in `api/year.ts` (a plan
step with no adapter is a compile error), checked by `validatePlan` in a test and never at runtime.
**Discogs is absent by DECISION, not by omission**: it was measured and dropped the same day (spike
§13.10–13.12) at ~1.1 s on average and ~2.4 s at p90 for about 5 known-right years per ~780 cards.
Re-adding it is a plan step, a trust tier, a `YearProviderId` member and an adapter. Eleven things.

- **Two agreeing providers are the stop rule**, so a MusicBrainz + Deezer agreement at `resolve`
  stands and iTunes is never asked. Measured on the 24 of 804 cards where iTunes disagrees with that
  pair: the pair was right 11 times and iTunes 4 (§13.12). The accepted price is pinned in
  `year-providers.test.ts`: Personal Jesus confirms at 1990 and iTunes' correct 1989 is never
  requested — the twenty-second track above, now wrong by vote as well as by recording.
- **Deezer's two dates are ONE voter; iTunes and Deezer are TWO, and counting the two stores as one
  is the edit to refuse** (`voterYears`, §13.11). Deezer's release-date year and ISRC year come from
  one catalogue row, so either can agree with another provider but they never confirm each other —
  that is what keeps Killing In The Name at 1992 against a 20th-anniversary edition that says 2012
  twice. Both stores carry the label's metadata, and merging them was measured and **rejected**: it
  undid three corrections §5.3 had verified by hand on the 542 (H.I.E.L.O., Happy Together, Iris),
  a net −4 known-right years there for +2 on the soundtrack decks. The correlated-reissue failure it
  targets is real and was accepted as the cheaper error: Pink Panther Theme confirms a WRONG 2006 on
  the two stores over MusicBrainz's `high` 1963, pinned on purpose.
- **When nobody agrees the card keeps ONE year, in the order MusicBrainz `high` > iTunes >
  MusicBrainz `low` > Deezer**, marked unconfirmed (`low` on the wire) and still shown (`decideYear`).
  iTunes before a `low` recovered A Whole New World (2014 → 1992) and The Time of My Life
  (2024 → 1987). **iTunes before a `high` was measured and rejected** — 6 known years worse (Killing
  In The Name 1992 → 2001, L'Empordà 1989 → 2010, three dubs moved to compilation dates) against 2–3
  better — so moving `itunes` one slot up is the edit to refuse. A lone Deezer counts only when its
  release-date year equals its ISRC year, the fresh-recording signature, because a release date alone
  is too often a reissue's. 112/125 labelled cards exact, against 110 for spike §12's order.
- **The year is the RECORDING's, not the film's or the original song's** (§13.9, the developer's
  answer). A cover dated by its own release, or a Spanish dub dated by the dub, is correct and not a
  bug to fix: it is what every provider answers, and the film's year would need a different lookup.
  **One deliberate exception: a `Re-Recorded` title resolves to the ORIGINAL recording** (the
  developer's ruling, 2026-09-30). The cleaner strips the tail, so Flashdance's 2014 re-recording
  reads 1983. A re-recording stands in for the original, so the original's year is the answer.
  A cover or a dub is a different performance and keeps its own year.
- **`finalWhenCertain` is OFF for all three providers.** Turning Deezer's on
  (`deezerRecentSignature`, dormant but tested — `La Grange - 2005 Remaster` must not fire it) lets a
  recent Deezer answer end a card alone. That is the MusicBrainz saving §12.3 measured
  (1 527 → 751 requests), and the developer has not asked for it.
- **`isrcYear` has NO 1986 floor, and adding one is the edit to refuse** (measured 2026-09-30). ISRCs
  date from 1986, so a pre-1986 year looks impossible, but major labels back-code their old catalogue
  with the ORIGINAL recording year (`SEAYD7601020` Dancing Queen 1976, 28 such rows across the spike's
  804 cards, every one right to within a year). A floor lost 4 confirmations on the 542 and fixed no
  shown year. The real garbage is narrower: the GBSMU bootleg registrant writes nonsense digits (29, 34) that hide a correct code through the minimum. That costs an iTunes request and can never confirm
  a wrong year alone. A named GBSMU exclusion is the narrow fix, and it is unbuilt.
- **Every provider is skippable with a warning, MusicBrainz included, and only "all of them" is
  loud** (the developer's decision). A `not-configured` provider counts as ABSENT: it is listed in the
  response's `skipped`, `console.warn`ed once per cold start naming the variable and never its value,
  and a final can still be reached without it. **The `not-configured` 500 needs every provider of the
  plan to report it in ONE call**, so structurally only `verify` can return it (`resolve` never asks
  iTunes) — and since neither store needs a key, the shipped registry never reaches it at all.
- **A transient failure is never a final "no year"**, because a final null drops the card (unless
  the session keeps yearless cards — and even then it would print a blank year the vote could have
  filled): any
  `failed` outcome without a confirmation makes the answer provisional and the client asks again.
  **A partial failure beside an answer is a 200 with `final: false`, never a 502** — a 502 would throw
  away a year the client can show while it retries; `upstream-unavailable` (502) means something
  failed AND nothing answered. `busy` (429 + `retryAfterMs`, from whichever provider's gate was full)
  stops the call at once, and what the same frontier obtained is already cached for the next call —
  **except on a `resolve` with an answer in hand** (2026-10-01, the developer's ruling): there a busy
  provider ends the asking and the call decides, a `200` with `final: false` (final only if the answers
  in hand confirm), so a fast Deezer year reaches the player while MusicBrainz's gate is full. **That
  200 still carries the busy provider's `retryAfterMs` in its body** (unless final), and the client's
  resolve lane sleeps on it before its next card exactly as on a 429 — without it the lane would fire
  the next card straight back into the full gate while `verify` re-asks MusicBrainz for this one, two
  waiters per client. **`verify`
  keeps the 429 on purpose**: the client counts a non-final verify 200 as a transient attempt and
  settles the card exhausted after six, while it sleeps on a 429 without counting. **And a non-final
  answer built on a failed or busy provider is `Cache-Control: no-store`** (2026-10-01, review B1): the
  verify lane retries the SAME URL within a second, so an edge copy would serve every retry the same
  failure and settle the card exhausted — a final null that drops it. A failure is a statement about
  the provider right now, the rule `withAnswerCache` already follows.
- **`verify` re-runs `resolve`'s frontiers first, and that is not a second resolve** (`STAGES_RUN` in
  `api/_lib/year-pipeline.ts`). On a warm cache every `resolve` provider was already answered by the
  batched read, so those frontiers are empty and `verify` asks only iTunes. They matter when the cache
  does not hold them — `vercel dev`, an evicted entry, a `resolve` whose MusicBrainz failed or was busy — because
  `verify` is the stage the client treats as the last word. It reads `resolve`'s answers from Redis,
  never from the client, so no client can put a year into the cache.
- **Every provider's answer is cached on its own, so a reorder needs no bump.** The stores live under
  `yearprov:<provider>:v1:` (30 days with a year, 1 day for a null; the version is per provider, so an
  adapter change discards only its own entries). MusicBrainz stays under its `mbyear:` key and is
  **never** wrapped in `withAnswerCache`, and the driver reads that key in the same `MGET`, so a warm
  card is one Redis command. The vote is recomputed on every call and no key encodes the order. A
  cached final vote (`yearfinal:`) was rejected because it would need a bump on every plan change and
  would pin a final reached while a provider was skipped. The edge gets at most the shortest source
  TTL for a final answer with nothing skipped, `no-store` for a non-final answer after a failure or a
  busy provider, and ~60 s otherwise. **A store lookup with no `durationMs` is never WRITTEN to its
  answer cache** (review W3): it can verify no row, so its null says nothing about the track, and the
  key carries no duration, so it would be served for a day to every card with the same artist and
  title. It still reads the cache. **And it sends no request at all**: the Deezer and iTunes adapters
  return that null with no gate permit and no fetch when `durationMs` is undefined, because spending a
  Deezer search and a slot on the 3 s global iTunes gate would buy a null known in advance; the
  no-write rule in `withAnswerCache` is the second guard behind them.
- **The stage-less `/api/year` is the old MusicBrainz-only path, byte for byte, and it stays** for
  tabs still running the pre-vote client: the service worker waits rather than calling `skipWaiting`,
  so such a tab lives until every tab closes, and it drops any card that comes back `null`. **It still
  answers the loud `not-configured` 500 on a missing `MUSICBRAINZ_USER_AGENT`, on purpose** — it has
  one provider, so skipping it is "every provider skipped", the same rule as the staged path. Do not
  "fix" one path to match the other.

Three as-built facts. **The handler's tests are `api/_lib/year-endpoint.test.ts`, NOT
`api/year.test.ts`** (the plan's name): `vercel.json` deploys every `api/*.ts` as a function, so a test
beside the handler would ship as `/api/year.test`, importing Vitest at runtime; `_`-prefixed paths are
not routed. **`api/_lib/store-http.ts` is the one gated GET both store adapters share** — a permit, one
GET, and every failure mapped to an outcome arm (a refused gate PERMIT → `busy`, the provider's own
refusal → a `refused` skip, network error or 5xx → transient
`failed`, any other non-2xx or a non-JSON body → `unexpected-payload`) — so Deezer and iTunes cannot
drift on the promise that an adapter never throws. Deezer's quota error is `{"error":{"code":4}}` with
**HTTP 200**, so it is read from the body. **Busy and refused are split by what the signal means**
(2026-10-01, the developer's rulings: "no cap while busy; if the IP is refused, stop", then "the
Deezer busy error should be retried, as well as all other provider busy errors"). **Busy**, retried
with no cap like our own full gate: Deezer code 700 (service busy), a Deezer 429 and an iTunes 429,
each with the provider's `Retry-After` when sent (else 5 s for Deezer, 30 s for iTunes, which the
client clamps to 10 s). **Refused**, a `refused` skip: an iTunes 403 and Deezer's quota error, code 4.
A provider shutting us out is left out of the call like a `not-configured` one, listed in `skipped`, warned once per cold
start, and the vote decides without it, so no card waits for ever on a provider that refuses. With
the option OFF a card can therefore settle without iTunes' vote, or as a final null if nothing else
answered. The ~60 s "final with something skipped" edge window is what lets it heal; and Deezer fetches
`track/{id}` for at most `DEEZER_TRACK_FETCH_LIMIT` = 3 verified hits, because a fourth found no year
the third had not. And **the licences of spike §10.1 still stand**: Deezer and iTunes may not be used
in a paid app, and MusicBrainz needs a plan or a mirror. The developer set that aside because the app
may be free, so dropping a provider is deleting its line from both constants.

## Year resolution: provisional years and the client resolver

**A CARD'S YEAR ARRIVES IN UP TO TWO STEPS AS OF 2026-09-30 — PROVISIONAL, THEN FINAL — AND THE FLAG
THAT SAYS WHICH IS STORED ON THE CARD WHILE THE THREE-WAY READING OF IT IS DERIVED**
([`plan.year-fetch-rework-game.md`](./plans/plan.year-fetch-rework-game.md)). `Card.yearProvisional`
is present only as `true`, only beside a numeric `year`, and written only by the reducer; `yearStateOf(card)`
beside the selectors in `reducer.ts` is the ONE reading of it — **pending** (`year` undefined),
**provisional** (the flag), **final** (anything else, a kept `null` included) — and every three-way
switch goes through it, `CardRevealSide`'s `YearSlot` with an exhaustive `never`. The flag lives on the
card because Restart re-deals `state.deck` through `START`: kept anywhere else, a restart would turn every
provisional card final and it would never be verified. A stored `yearStatus` was rejected as a second copy
of `year` that can disagree with it, and a tagged union replacing `year` as a save migration plus ~100
test sites. It is additive — **no save-format bump**, the `startIndex` precedent. Seven things.

- **There is no provisional null.** `YEAR_RESOLVED` is a union of a FINAL arm (today's payload,
  number or null) and a PROVISIONAL arm (a number, `low`, `provisional: true`); a `resolve` that found
  nothing dispatches nothing and the card stays PENDING. **A provisional answer never downgrades a final
  card** — the reducer returns the same state object — because the order between lanes is not
  guaranteed after a resume or a retry. A final number replaces a provisional year on **every** card,
  the one the player is reading included.
- **The resolver runs TWO LANES, ONE REQUEST IN FLIGHT PER STAGE** (`resolver.ts`'s header). One slot
  per stage because each stage sits behind its own provider gates on the server, and a single queue with
  two slots would let **one client hold two MusicBrainz lookups** against a gate shared by every user as
  a matter of course. **One slot per stage NORMALLY means one MusicBrainz lookup per client, not
  always** (corrected 2026-10-01): the server's `verify` re-runs `resolve`'s frontiers, so a card with
  no cached `mbyear:` entry (its resolve-stage lookup failed or met a busy gate, the entry was
  evicted, or always under `vercel dev`) has its `verify` call MusicBrainz while the resolve lane may
  be calling it for another card. In the busy case — the common one under contention — the resolve
  lane sleeps the server's `retryAfterMs` instead of firing the next card into the full gate — which
  cuts the waiters, but does NOT guarantee one: the verify re-ask usually meets the same full gate,
  429s and sleeps about as long, so the two lanes can wake together and each send a lookup. Accepted rather than "fixed" by skipping MusicBrainz in `verify`, which would lose its vote —
  the best coverage of old catalogue and the only "first release" date — on exactly the cards whose
  first try failed. One resolver rather than two workers because the resolve-to-verify hand-off
  would land in the hook (whose header forbids logic), there would be two teardowns, and nothing would
  push the start card into verification while the loading screen waits on it. "Do not optimise into a
  parallel fetch" still stands, per lane. On a 429 **only that lane sleeps**, then picks again — and the resolve lane also sleeps after a
  non-final `resolve` 200 that carries `retryAfterMs` (a busy provider beside an answer); one
  `AbortController` and one `stop()` end both, and `not-configured` halts both.
- **Every card is in one of three stage states** — `needs-resolve`, `needs-verify`, `final` — **seeded
  from the deck**: an undefined year needs resolve, a `yearProvisional` year needs verify (a resumed
  provisional card goes STRAIGHT to verification), anything else is final. The seed used to be "has a
  year = done", and that line is one of the TWO places a resumed provisional card would have silently
  become final and never been verified. The other is `persistence.ts`'s `validateCard`, which rebuilds a
  card field by field — it copies `yearProvisional` only as `true` beside a numeric year and **rejects**
  it otherwise.
- **The verify lane's pick order is the current card, then the nearest card needing verify within
  `VERIFY_LOOKAHEAD_CARDS` (3) ahead of it, then the rest first-in-first-out.** Forward only, no wrap;
  3 is a guess to tune on a device and its comment says so. When there is nothing to do the lane waits
  on a PROMISE the resolve lane settles, never a timer. `prioritize()` remembers the urgent card, so when
  the start card's resolve answer lands during `preparing` it goes to the FRONT of verify — without that,
  `currentCardId` never changes on the loading screen and the hook's `prioritize` would never fire again.
- **A non-final verify is a TRANSIENT**, not an answer: the server's `final: false` means a provider
  failed transiently, so its year (if any) is shown provisionally and the card is retried like any
  transient failure.
- **Exhausted verify settles the card FINAL at the best single answer it has** (spike §10.3): its
  provisional year at `low`, or a final `null` if resolve found nothing either (or never answered).
  Otherwise the card waits for ever, and the PDF with it. **An exhausted RESOLVE hands the card to
  verify rather than settling null** (2026-10-01, the developer's ruling, reversing plan 3 step 4's
  "settles null exactly as today"): a provider outage must not drop cards on the client when the
  server was built never to turn a transient failure into a final "no year", and `verify` asks more
  providers. So an exhausted verify is now the only route to a null after transient failures; a 400
  still settles null at once. **An exhausted verify's YEAR is marked `yearUnverified`** (2026-10-01,
  the developer's ruling): it is the provisional year with no verdict — verify could not be ASKED,
  typically a device offline, which exhausts every card in flight within seconds —
  so "skip unconfirmed years" never drops it (`isDroppedAnswer`), and the reveal reads "Year could
  not be checked" (`COPY.card.yearUnverified`, same amber) instead of "Unconfirmed year". **Only
  when NO verify call for the card ever came back with a year** (the developer's second ruling,
  later that day): if any non-final 200 carried one — iTunes failed, or a provider answered and
  nothing confirmed it — the card settles that year as an ordinary UNCONFIRMED `low`, which the
  vote already chose by `UNCONFIRMED_TRUST`, so the client needs no list of who answered. An
  iTunes outage therefore yields unconfirmed years, not unchecked ones. **That "some verify
  answered" fact is saved too**, as `Card.yearVerifyAnswered` (only `true`, only beside
  `yearProvisional`, cleared by any final answer): the resolver reports it with the provisional
  year — once, even when the year did not change — and seeds itself from it on resume, so a reload
  between that answer and the exhaustion does not turn an unconfirmed card into an unchecked one.
  The unverified mark itself is stored on
  the card, copied by `validateCard` only as `true` beside a numeric, non-provisional year, written
  only on a FINAL answer; additive, no save bump. It is never retried, on resume either. **The null
  keeps its old rule and cost**: an exhausted card with no year still drops while yearless cards are
  dropped. Merging "unchecked" back into "unconfirmed" is the edit to refuse — it deletes cards,
  permanently, for a network blip.
- **The year selectors now disagree ON PURPOSE.** `isCurrentYearPending` stays "`year` is undefined",
  because a provisional card SHOWS its year; `resolvedCount` excludes provisional cards, so
  `pendingYearCount` counts them as pending and the PDF waits for verification. Two questions, two
  answers — do not "fix" one to match the other; the comment above `pendingYearCount` says the same.
  **Since 2026-10-01 nothing in production reads `isCurrentYearPending`** (the reveal reads
  `yearStateOf`, and the review removed the field from `useGameSession`'s return). The selector is
  kept, with its tests, as the definition of "pending"; wiring it back into a screen beside
  `yearStateOf` would reintroduce two readings of one state.

## PWA, service worker and index.html

**The app is a PWA, and the service worker's two most important properties are things it deliberately does NOT do.** `vite-plugin-pwa` in `generateSW` mode; the manifest is a typed module at `src/pwa/manifest.ts` (imported by `vite.config.ts` and by nothing in the app, so it is not in the client bundle). **It precaches the build output and nothing else — `runtimeCaching` is empty on purpose**: a cached `/api/playlist` would deal a deck that no longer matches the real playlist, and `/api/year`'s freshness story is the shared Upstash cache, so a browser-local copy is a hole in that design rather than an extension of it. **And the update strategy WAITS rather than calling `skipWaiting`**, because the app code-splits `GameScreen`, the QR encoder and the PDF chunks — a worker activating mid-game after a redeploy leaves the tab requesting a chunk hash that no longer exists, so the next card is a hard failure. Two consequences to know before "improving" either: offline means the shell loads and a **saved session** stays playable minus audio and lookups, and an update lands only once every tab is closed. **`devOptions` is absent**, so neither `pnpm dev` nor `npx vercel dev` ever registers a worker. See [`docs/architecture.md`](./architecture.md) §3.

**Comments in `index.html` are shipped bytes**, unlike comments in `src/` — it is the blocking document on the critical path and nothing strips it. Keep the reasoning in [`docs/architecture.md`](./architecture.md) §3 and one-line pointers in the file. Two literals there are load-bearing: `theme-color` **must** track `--color-page` by hand (a `meta` attribute cannot hold a `var()`), and the favicon is a 20 kB WebP that replaced a **1.26 MB PNG which was costing 6.2 s of LCP** — never restore a large icon.

## Google Play: the back press and the TWA shell

**THE ANDROID BACK PRESS IS AN IN-APP CONTROL AS OF 2026-08-12, SO THERE IS EXACTLY ONE `pushState` IN
THE APP AND IT IS NOT IN `App.tsx`.** `GameScreen` calls `useBackNavigation`, which pushes ONE history
entry for the duration of a game and turns a back press into the same exit REQUEST the Exit button
makes — or, with a dialog up, into closing that dialog. It exists because a TWA has **no entry to go
back to**, so the gesture closed the activity outright, bypassing `ExitConfirmDialog` **invisibly**:
the session survives in `localStorage` and a relaunch resumes, so the player reads it as the app
quitting at random rather than as a game they lost. The decision is the pure
`src/game/back-navigation.ts`; the hook holds no branching. **`App.tsx` is deliberately untouched** —
the two dialog flags live in `GameScreen`, and lifting them would widen the one file that knows all
four statuses exist. Six things before editing any of it. **Back is a request, never an exit** (`END`
clears the save, so a direct exit would destroy the deck with no question asked), and the action is
called `request-exit` so wiring it to `onExit` reads wrong. **Mounting IS the scoping** — no status
check exists anywhere, because `GameScreen` is mounted exactly while the status is `playing`, and an
exclusion list of screens is a thing to forget to update. **The entry is REPLACED after every press**:
one entry consumed once makes the fix work exactly once per game — press back, cancel, press back
again, and the activity closes. **The cleanup removes the listener BEFORE it navigates**, and both
orderings pass today (the traversal is queued, so the listener is gone either way) — which is why the
order is pinned as a **call order** rather than as a behaviour, and why "simplify it, the suite is
green" is the wrong conclusion. **`history.length` is not an instrument** for the stray-entry failure,
in jsdom or in a browser: going back retains the forward entry, so the tests assert the current
entry's identity. And **`pendingCleanupTraversals` cannot be justified by a local test** — jsdom
discards a queued traversal when a `pushState` beats it, where Chrome re-resolves the delta and fires
the phantom pop that the counter exists to swallow. The browser-side change is **accepted, not
suppressed**: desktop and mobile-Chrome back now open the confirmation too, and there is deliberately
no user-agent sniff. Full reasoning in [`docs/architecture.md`](./architecture.md) §3; **every
device check is still outstanding** and cannot be run in Chrome.

**THE STORE SHELL IS A FOURTH TOP-LEVEL TREE.** _Updated 2026-10-01: `bubblewrap init` created
`android/` on 2026-09-20, and **only `android/twa-manifest.json` is tracked** — the generated Gradle
project, `manifest-checksum.txt`, `assetlinks.json`, the keystore and the build artefacts are each
named in `.gitignore`. The rest of this paragraph is the 2026-09-19 state, kept as history: on that
day the tree did not exist, and grepping for it and finding nothing was the correct reading._
[`docs/plans/plan.google-play-shell.md`](./plans/plan.google-play-shell.md) packages the deployed
PWA as a Trusted Web Activity, and its steps 1–5 landed on 2026-09-19 while steps 6–18 did not.
**It is FROZEN as of 2026-09-19, along with the back-button plan, and
[`docs/plans/plan.play-store-todo.md`](./plans/plan.play-store-todo.md) is the only file to
execute from** — the two old plans keep their reasoning and their history, and their unfinished boxes
tick only when the step that owns them in plan 3 ticks. Plan 3's steps 2, 3 and 8 are built: the
deployed asset-links and privacy fetches are recorded, the picker's first suggestion is relabelled
(below), and `visual-assets/tester-notes.md` exists. **What
exists today**: `public/.well-known/assetlinks.json`, `public/privacy.html`, `src/pwa/assetlinks.test.ts`,
four new manifest fields (`id`, `lang`, `dir`, `categories`) and an Android block in `.gitignore`. **What
does not**: `android/`, any keystore, any certificate fingerprint, any Play Console app. The rules below
are written as rules rather than as plans because each governs an edit that is cheap to make today and
expensive to discover later — **every one of them fails on a DEVICE, after an install, with a green
build**. Six things.

**`android/` is subject to none of the `src`/`api`/`shared` import rules**, because it is not TypeScript:
it is a Gradle project Bubblewrap generates from `android/twa-manifest.json`, and **that one file must
stay tracked** — it is what makes a release reproducible, and it is the second home of the application
id. **The rest of the generated project need not be tracked** — answered 2026-09-19 by reading the
installed CLI: `bubblewrap update` DELETES `settings.gradle`, `build.gradle`, `gradlew`, `gradle/` and
`app/` outright and rebuilds them from the config plus re-fetched icons, so committing them would only
commit output. Their ignore entries landed on 2026-09-20, when the files first existed; `.gitignore`
names each regenerated path (`android/app/`, `android/gradle/`, `android/gradlew`, …) **one at a time
and never widens to `android/`** — the widening is the edit that silently untracks the config. **The trap that follows
from the same reading:** `app/build.gradle` is regenerated too, so step 8's `targetSdkVersion` bump
must be expressed in `twa-manifest.json` — hand-edit it and the next `update` discards it, and the
symptom is a Play upload rejected months later. See `docs/agent_findings.md` (2026-09-19).

**`@bubblewrap/cli` is installed globally with `npm i -g`, and must NEVER enter `devDependencies`.** It is
an explicit, recorded exception to the pnpm-only rule rather than a violation of it: a project dependency
would pull an Android toolchain into `pnpm-lock.yaml` for a tool **not one of the four pre-commit checks
needs**; the install goes through `npm i -g`, so it never touches `pnpm-lock.yaml` at all. `pnpm add -D
@bubblewrap/cli` is the edit to refuse. The installed versions belong beside the release process in
[`docs/development.md`](./development.md), because the next release runs against whatever the
machine has then.

**The keystore is never committed** — `*.keystore` and `*.jks` are ignored, and no keystore exists yet
(step 7 mints it). **State the recovery position accurately, because the folklore overstates it**: with
Play App Signing, Google holds the app _signing_ key, so a lost **upload** key is a Play Console support
round-trip rather than the end of the app's update path. **Leaking one is the unrecoverable direction** —
an upload key in a public history is one anyone can build a release with, and no rotation un-publishes it.

**The application id (`aleixrabassa.playlistjitster`), `manifest.id` and `start_url` are PERMANENT after
the first publish**, and changing any of them installs a **SECOND APP** rather than an update — with no
build error, no install failure and no warning anywhere. That is exactly why `id` is now written out in
`src/pwa/manifest.ts` instead of left to default: the spec defaults `id` to `start_url`, so an edit to
`start_url` (a deep link, a `?utm_source=` tail) would have moved the store identity as a **side
effect**. It is pinned by **`should keep id equal to start_url`** in `src/pwa/manifest.test.ts`, and the
package id by **`should target the android_app namespace and the committed package id`** in
`src/pwa/assetlinks.test.ts`, and joined across files by **`should agree with android/twa-manifest.json
about the package id`** beside it (2026-09-23) — the only thing that can catch the two copies drifting
apart. The same file now also pins every fingerprint's format and that the deployed list equals
`twa-manifest.json`'s; only the **count of two** waits for Play's key at step 11.
**`id` resolves against the ORIGIN**, so the origin sits inside the app's identity: the last rule below is
the same fact seen from the other end — so moving to a custom domain later is a rebuilt shell and a new
asset-links deployment for the TWA, a SECOND install identity for every browser PWA install, and never a
redirect from the old origin: a TWA whose origin redirects has left the verified origin, which is a URL
bar.

**The TWA shares `localStorage` with the browser hosting it** — a Chrome TWA runs in Chrome's own
profile, so `jitster:session:v1` and `jitster:library:v1` on the origin are **one store seen from two
launchers**: a game started in the installed app resumes in the browser, and the reverse. **That is the
persistence design doing its job, not a defect**, and it is what makes the back-press block's "a relaunch
resumes" true at all. Namespacing the keys per launcher to "fix" it breaks that, and a renamed key is not
read — the 2026-09-30 `hitster:*` → `jitster:*` rename (see the rename block) paid exactly that cost once, on purpose. Unverified on a device; it is step 9.

**The origin `https://playlistjitster.vercel.app` is load-bearing and permanent**, and
`public/.well-known/assetlinks.json` is fetched from it by the **Android system verifier**, not by the
webview. Three consequences. It is deliberately **absent from the precache** — `globPatterns` lists no
`json` — because a browser-local copy of a file the OS reads over HTTPS is useless as well as wrong.
`vercel.json`'s one rewrite `source`, `/((?!api/|@)[^.]*)`, **must keep its `[^.]*` dot exclusion**:
widen it to `.*` and the file comes back as `index.html` with a **200**, which the verifier reads as no
statement at all and the installed app grows an address bar — **a URL bar on a green build**, the single
failure this plan is shaped to prevent. `assetlinks.test.ts` pins that character class, and a string
assertion is the honest ceiling there (re-implementing path-to-regexp in a test would be worse than no
test). And **the fingerprint list holds exactly ONE fingerprint as of 2026-09-21, which is not the
finished state and is not a bug either** — it is the **upload key**, read off the built APK with
`apksigner verify --print-certs` and deployed ahead of the plan's own schedule because the developer
asked for the URL bar to go on the first sideloaded install; that press decided plan 3's open question,
which had parked the move for a stall that never came. **It verifies every LOCAL sideload and nothing a
tester installs**, because Play re-signs with its own app signing key. So step 11 **ADDS** Google's
fingerprint beside this one and **never replaces it**: a one-fingerprint file is **a valid file that
produces a URL bar** on exactly the installs that come from the store, which is the classic version of
the mistake and is now half-committed on purpose. Do not guess a value into it, and do not read the
single entry as finished. Fuller reasoning in
[`docs/architecture.md`](./architecture.md) §3; the device checks are rows in
[`docs/development.md`](./development.md) §5, where **rows 1 and 6 are half passed as of
2026-09-21** — the bar was seen and then seen gone on one sideloaded build, either side of this
deploy, and that build plays end to end — and **every other row is Pending**. Those two are the rows
that run on BOTH builds, so "half passed" means the sideloaded half; the Play-signed half is owed.

## The name and the rename boundary

**The app is "Playlist Jitster" as of 2026-08-11 — and the RENAME'S BOUNDARY is the part to know.**
Renamed: `index.html`'s `<title>`, `manifest.name`/`short_name`, `LandingScreen`'s `<h1>`, README's
heading, and `pdfFileName`'s prefix (`hitster-*.pdf` → `jitster-*.pdf`, because a downloads list is
user-visible). **Never rename** every "Hitster" that means the BOARD GAME (`pdf-sheet.ts`'s header,
which since 2026-09-21 explains why the board game's 65 mm card size was DROPPED, `reducer.ts` and
`messages.ts` on dropping a yearless card, `CardRevealSide`, the trademark guards in
`LandingScreen.test.tsx` and `i18n.test.ts`) — renaming those corrupts the reasoning. **The internal
identifiers followed on 2026-09-30, at the developer's request, and that reverses this block's old
"never rename the keys" rule**: the three `localStorage` keys are `jitster:session:v1`,
`jitster:library:v1` and `jitster:locale:v1` — a **hard rename with NO migration**, so anything saved
under `hitster:*` is abandoned, knowingly — and the package name, `MUSICBRAINZ_USER_AGENT`,
`api/hello`'s message, the `https://jitster.example` test origins, `useBackNavigation`'s
`customJitsterBackEntry` history state and `docs/plans/custom-jitster-mockup.png` all read
`jitster`. **What still says `custom-hitster` is not this repo's to rename**: the checkout directory,
the Vercel project name, the old `custom-hitster.vercel.app` alias, and the dated provenance comments
on the MusicBrainz fixtures (they record the User-Agent those captures were actually taken with).
`docs/plans/` and existing `docs/agent_findings.md` entries keep the old names as history. **The PWA ARTWORK was NOT unaffected, and this line used to
claim it was**: the icons did carry a "PLAYLIST HITSTER" wordmark — nobody opened the image, because the
rename was reasoned about as a string change. New artwork reading "PLAYLIST JITSTER" landed on
2026-08-12 and the whole set was regenerated from it, so "one identity everywhere" now holds by
regeneration rather than by the absence of a wordmark. **No check in this repo has ever opened an image.**
**THE BOUNDARY MOVED ONCE MORE, ON 2026-09-19, AND ONLY WHERE THE STORE FORCES IT:** the `'Hitster'`
label on `SUGGESTED_PLAYLISTS[0]` is gone from the picker, relabelled **`'Jitster official'` with the
id unchanged**, because a Google Play listing may not carry the registered mark and the picker is in
every screenshot of it (`visual-assets/listing.md` §1). It cost nothing in faithfulness: the playlist's
real Spotify title is **"Hitser"**, one _t_, so the mark existed only in this app's own tidied
rendering of a typo — which is why `LandingScreen.tsx`'s "labels are readable renderings of Spotify's
own titles" paragraph now carries a sentence saying the first row is labelled for the APP instead, and
why `LandingScreen.test.tsx` guards every row's `label` and `blurb` against the mark case-insensitively
(a guard over DATA, not over `COPY.*` wording — the array was never copy). **The label now reaches
past the picker (2026-09-24)**: `src/game/playlist-display-name.ts` maps that id to the app's label, and
`deckLabel()`, the end screen's list and `loadLibrary` read through it — so the HUD, the PDF filename
and saved-library rows no longer render the fetched "Hitser". It is applied ON READ, which is what
heals sessions and library entries saved before it; a write-time rename would have left them. The
`LandingScreen` row reads its label from that module, so picker and HUD cannot disagree. Every
internal "Hitster" that means the board game is untouched, and a store rule about visible text is not
a reason to touch one of them.

## Local development and test fixtures

**The app is only playable under `npx vercel dev`, never `pnpm dev`.** Vite serves `api/playlist.ts` as transpiled source with status 200, so pressing Start under `pnpm dev` shows the `unexpected-payload` error copy ("Spotify returned something we could not read"). That is the client behaving exactly as designed, not a bug — see [`docs/development.md`](./development.md) §4.

**The Phase 4/5 fixture harness is gone**, and so is `public/dev-preview.wav`, the generated audio file that stood in for the fixture cards' invented preview URLs. The fixture deck itself stays at `src/components/__fixtures__/cards.ts` — it is what every component test renders from. To look at one specific card shape, run a component test in watch mode; there is no longer a page that walks the deck.

## Manual verification outstanding

**What is left in Phase 8 is entirely MANUAL VERIFICATION, and it is now the project's largest gap.** Nothing is waiting on a decision or on code. Everything automatable is automated, and the ceiling is genuinely low here — jsdom paints nothing, evaluates no media query, computes no layout and has no accessibility tree — so what remains needs a deployment, a printer, a phone and a screen reader. Scoped row by row in [`docs/development.md`](./development.md) §5, gaps in its §8. **Run the screen-reader pass over one flip first**: it is the only check on the app's only live region, which is what makes the game's payoff audible at all, and it has now been carried by two phases without being run.

**Phase 7's first half is verified only at the ends of each contract, never in the middle**, and that is a property of the environment rather than of the effort: jsdom evaluates no media queries, has **no `window.matchMedia` at all**, computes no layout, and has no accessibility-tree consumer. So a component asserts it renders a `data-motion` hook and `src/index.css.test.ts` asserts the stylesheet names it — and nothing checks that reduced motion, the responsive clamp, the focus rings or the reveal's live region actually work. Four manual passes are scoped row by row in [`docs/development.md`](./development.md) §5, all Pending. **The screen-reader pass matters most:** the reveal's live region is the phase's most valuable single change (before it, a flip was silent and the year was unreachable without sight) and nothing local confirms it announces.

**Manual verification outstanding, and no local check will ever close it:**

- 2026-09-18: **nothing about the welcome screen, the PDF download or the left swipe has been seen outside jsdom.** The two that matter: a click on the download in a tab the service worker controls must save the PDF and not reload the app (the `.pdf` denylist is unobservable under any dev server), and a left swipe on a phone must step back where a right swipe advances — the mapping is unit-tested, the thumb is not. Rows in [`docs/development.md`](./development.md) §5.
- Phase 4: the QR scan was verified on a real phone (2026-08-05, re-confirmed 2026-08-06). The **devtools DOM search on an unflipped card** is still owed.
- Phase 5: **the iOS half of the touch pass has still never been run** — the 2026-08-06 pass was Android only, so tap-versus-swipe under Safari, pull-to-refresh suppression, whether the card needs `select-none`, and whether audio starts from the first tap are all open. Checklist in [`docs/development.md`](./development.md) §5.
- The **lock-screen fix needs one re-check** on the phone: play, lock, confirm silence, unlock, confirm Play continues rather than restarting.
- Phase 6: **progressive loading against a real preview deployment with Upstash configured** (step 15 of [`plan.phase-4-6-screens.md`](./plans/plan.phase-4-6-screens.md), carried over from Phase 3) is not done. Nothing local models it: the shared cache and the 1 req/s gate are both backed by the Upstash variables, and without them the gate paces nothing. It also owes the **50-track cold-deck wall clock**, unmeasured since Phase 2, and a **count of `/api/year` requests under React 19 StrictMode** — `use-game-session.ts` has a double-crawl guard that nothing tests.
- The two browser checks the 2026-08-05 decisions owed — **one swipe** for `popLayout`'s measurement (jsdom computes no layout, so it bails there no matter what the code does) and **one QR scan at the larger 14/18 size** — were both closed by the 2026-08-06 Android pass. **The square card of 2026-08-11 does not reopen the scan**, and that is by construction: the ratio went to 7/12 only because its denominator changed, so the code is displayed at the same 224px / ~140px it was scanned at.
- The square card and the enlarged QR owe **five of the "three widths" rows** (2026-08-11): that the card is square at all three, that the control row's four gaps read as equal, **one scan on the 240px floor card** (the face is `overflow-hidden`, so a QR that does not fit is cropped rather than visibly overflowing, and a cropped code fails to scan while looking almost right — and the enlargement has its least margin exactly there), that the relocated scan caption is legibly dim under a card with a bloom around it, and that the footer does not push Start off a 320px landing screen.
- Phase 8: **nothing about the PDF export has been verified on paper.** The geometry, the pagination and the duplex mirror are unit-tested; the printer, the cut and a scan of a printed code are not. Six sharing/printing checks in [`docs/development.md`](./development.md) §5.
- Phase 7 (first half): **all four behavioural passes are outstanding** — reduced motion with the OS preference set, three widths, keyboard-only, and a screen reader over one flip — plus the before/after screenshot comparison. The environment is the reason, not the effort: jsdom has no media queries, no `matchMedia`, no layout and no a11y tree, so class-name assertions are the ceiling. **Prioritise the screen reader.** Checklists in [`docs/development.md`](./development.md) §5, gaps in its §8.

## Key rules, environment and Spotify, in full

### Key Rules

**Layout and imports** — details in [`docs/architecture.md`](./architecture.md) §2

- `src/` = browser (may use the `@/` alias and DOM APIs) · `api/` = Node · `shared/` = both, so **no DOM and no Node APIs**.
- **`shared/` holds the DECISION half of the year vote as of 2026-09-30.** `shared/year-providers.ts` = the provider plan, the trust order, the voter rule, the confirmation, the frontier, `isrcYear` and the provider cache key; `shared/store-match.ts` = whether a Deezer or iTunes row is the SAME recording (equal cleaned title, every primary-artist token in the credit — deliberately NOT `artistMatchesExact` — a duration within tolerance where a length-less row fails, and the earliest verified row wins). Both sit beside `shared/year.ts` and are node-tested with no HTTP. The BINDING half is `api/_lib/`: `year-pipeline.ts` (the thin driver), `provider-lookup.ts` (the adapter contract), `deezer.ts` and `itunes.ts` over `store-http.ts`, and `musicbrainz-provider.ts` (wraps `resolveYear` whole). A vote rule that starts growing in the driver belongs in `shared/year-providers.ts`, same rule as `gestures.ts`. `store-match.ts`'s mutation guard lives in `api/_lib/year-votes.test.ts`, because the captured payloads are Node-side fixtures and a `shared/` test importing `api/` would drag them into the browser typecheck.
- **`src/` has four subtrees, and which one a file belongs in is a real decision.** `src/game/` = the session (reducer, shuffle, resolver, persistence, gesture _decisions_, the playlist client, the error-copy map) — pure and framework-free apart from one hook. `src/components/` = presentational React, props in and callbacks out, no session knowledge. `src/hooks/` = the stateful concerns a component should not own (audio, gesture _binding_, the playlist request). `src/components/__fixtures__/` = the shared fixture deck every component test renders from. **`src/game/browser-storage.ts` is the one other non-pure file there** (2026-10-01): the guarded `window.localStorage` read every first-render caller shares — kept beside `persistence.ts`'s `StorageLike` on purpose, not misplaced. **The loader in `src/game/preloaded-years.ts` is the second exception** (2026-10-01): `loadPreloadedYears` is a memoised dynamic import of the ~170 kB table and `preloadedYearsWithin` caps the wait for it with a timer, both a deal's (after the playlists arrive) and the crawl's (once, at its first lookup), so a stalled chunk never strands either. It stays beside the pure `applyPreloadedYears` / `withPreloadedYears` it feeds because it is about a dozen lines with no React in it, so `src/hooks/` would be the wrong home; its side effect is loading a code chunk, not state. Logic that starts accumulating in a component belongs in a hook or in `src/game/`.
- **`src/App.tsx` is the ONLY caller of `useGameSession()`**, and the only file that knows all four statuses exist. Screens receive plain data and callbacks. `dispatch` is deliberately not exposed by the hook, so a screen cannot invent a transition the reducer's tests never considered — if a screen seems to need a fifth action, add it to the reducer with its tests.
- **Both HTTP clients live in `src/game/` and take an injected `fetch`** (`year-client.ts`, `playlist-client.ts`), with a thin hook over each. That is what keeps every status branch a **node-environment** unit test with no jsdom and no network. Anything that accumulates in the hook belongs in the client instead.
- **The decision/binding split is the house style, and it exists because of what cannot be tested.** Phase 3 did it for the resolver; Phase 5 did it for gestures. `src/game/gestures.ts` holds every threshold and comparison as pure functions over numbers; `src/hooks/useCardGestures.ts` only collects coordinates and dispatches. The reason is specific: **jsdom cannot exercise a drag** — Motion's drag reads element geometry jsdom does not compute, so a simulated pointer sequence tests the double, not the gesture. Thresholds left inline in the hook would be untested full stop. When adding gesture behaviour, the decision goes in `src/game/`, not the hook.
- **`api/` must import `shared/` by RELATIVE path, never via `@/`.** Vercel does not support tsconfig path mappings for functions — an aliased import type-checks locally and **fails at deploy time**. Grep for `@/` under `api/` before deploying. `api/hello.ts` is the minimal reference shape; `api/playlist.ts` is the reference for a real endpoint (method guard, query handling, typed-error-to-status mapping).
- **Every relative import that can end up inside a function bundle needs an explicit `.js` extension** — `'../shared/constants.js'`, not `'../shared/constants'`. That covers all of `api/` and any `shared/`→`shared/` **runtime** import (type-only imports erase, so they are exempt). `"type": "module"` makes the deployed function ESM, and Node's ESM resolver does not guess extensions; Vercel transpiles rather than bundles, so the specifier reaches Node verbatim. Getting this wrong yields `FUNCTION_INVOCATION_FAILED` at runtime after a build that logs **no error**, and **all five local checks pass either way** — measured on a real deploy 2026-08-04, see [`docs/agent_findings.md`](./agent_findings.md). TypeScript and Vite both resolve the `.js` specifier back to the `.ts` source, so the same form works in the browser build and under Vitest.
- New files must land in the right tree, because that determines which typecheck config covers them.

**TypeScript** — details in [`docs/toolchain.md`](./toolchain.md) §1–2

- **Two TypeScript installs exist on purpose.** `typescript` (6.0.3) is there _only_ so `typescript-eslint` can load; `typescript-7` (7.0.2) is the real compiler. Don't delete either, don't flip which one is aliased.
- **Never call bare `tsc`** in a script — the bin slot is contested. Invoke compilers by explicit path.
- **Root `tsconfig.json` must never become a solution file** (`files: []` + `references`). Vercel reads it to compile `api/`; a references-only root breaks the function build **at deploy time only**. No `references` and no `composite` anywhere. `build` must never become `tsc -b && vite build`.
- No `baseUrl` (removed in TS 7); `paths` targets must be relative.

**Conventions**

- **NEVER regenerate the visual assets on your own initiative — only when the developer asks for it.** That covers everything under `visual-assets/` (the store screenshots, the feature graphic, the Play icon, the social graphics, the Canva designs behind them) and the icon set derived from the logo master. A code or copy change that makes a screenshot stale is a reason to _tell_ the developer, never a reason to re-run `screenshots.mjs`, re-export from Canva or rewrite an image. Rule set by the developer, 2026-09-24.
- **pnpm only**, with exactly one recorded exception. Don't add `package-lock.json` or `yarn.lock`; keep `pnpm-lock.yaml` committed. The exception is `@bubblewrap/cli`, installed globally with `npm i -g` and never a project dependency — see the store-shell block above.
- **`engines.node` is `24.x` and deliberately does not match local Node.** Don't "fix" it. The `Unsupported engine` install warning is expected.
- **Prettier owns formatting.** No hand-formatting, no stylistic ESLint rules.
- **The copy surface is `src/game/copy.ts`, exactly as the design surface is the `@theme static` block.** A component renders `COPY.*` and a test asserts against `COPY.*`; a user-facing literal in either is the thing to catch in review, for the same reason a stray `bg-neutral-900` is — copy is reworded by changing one value, and a literal is invisible to that. Templated strings are functions so pluralisation cannot drift. **Since 2026-09-28 a component reads `copy` from `useCopy()` rather than importing `COPY`**, and a new English key must be translated in `copy.es.ts` and `copy.ca.ts` or the typecheck fails — tests keep asserting against `COPY.*`, or against `CATALOGUES[locale].copy.*` when they render inside a provider. `messages.ts` keeps the error map (its `Record<StartFailureCode, string>` exhaustiveness is the point); `index.html`, `src/pwa/manifest.ts` and `public/privacy.html` are outside the rule — none can import a runtime module — and copy `COPY.app.name` by hand.
- **Tailwind v4 is CSS-first** — no `tailwind.config.js`. **The design surface is the `@theme static` block in `src/index.css`**, which is where a v3 reader would look for that config file: every colour, dimension, duration and interaction minimum in the app is named there. **A new component consumes tokens rather than inventing literals** — a colour written as `bg-neutral-900` instead of `bg-surface` is the thing to catch in review, because Phase 8 redesigns by changing token values and a stray literal is invisible to that. `focus-ring` and `touch-target` are `@utility` composites in the same file; every interactive element gets `focus-visible:focus-ring`.
- **An unknown Tailwind colour utility is a SILENT no-op, and all four checks pass either way.** `text-text-muted` against a theme defining `--color-fg-muted` emits **no rule at all** — no warning, no build error. It shipped once: the only text on the card's hidden face lost its colour and rendered near-black on a near-black card while typecheck, lint, test and build stayed green. When adding or renaming a token, grep the built CSS (`dist/assets/*.css`) for the utility, and prefer a class-name assertion in the component's test — `CardHiddenSide.test.tsx` has one.
- **`@theme static`, not bare `@theme`.** A plain `@theme` tree-shakes any token no generated utility references, which silently kills the ones consumed only through `h-(--card-height)`-style arbitrary values, through an `@utility`, or from inside the `prefers-reduced-motion` block.
- Vitest config lives in the `test` key of `vite.config.ts`. **The default environment is `node` and stays that way** — it is what makes a DOM API accidentally added to `shared/` (which must stay portable to `api/`) fail a test run. A test needing a DOM opts in **per file** with a `/** @vitest-environment jsdom */` docblock as the first thing in the file. Do not globalise jsdom.
- **Testing Library does not clean up between tests here.** Its auto-`afterEach(cleanup)` only registers when Vitest `globals` are on, and this repo imports `describe`/`it`/`expect` explicitly — so every DOM test file needs its own `afterEach(cleanup)`. Without it, a test queries a DOM still holding every previous render, and the failure reads as a component bug.
- **The hidden side of a card must leak nothing, and the audit covers more than visible text.** Attributes, `aria-label`s, `alt` text, live regions, and the OS media session are all leak surfaces. Never set `navigator.mediaSession.metadata`. See [`docs/architecture.md`](./architecture.md) §3.
- **`CardRevealSide`'s live region is the ONE place announcing track data is correct, and it is not a bug.** Phase 7 gave the reveal a polite `role="status"` because the flip was otherwise silent to assistive technology — the year, the payoff of the whole game, was reachable by sight only. It is safe because `Card.tsx` mounts that component **only while the card is flipped**, so the region cannot exist on a card that is still a mystery. **Since 2026-09-30 the same region also announces "Confirming year" (`COPY.card.yearProvisional`) and a year the `verify` stage CHANGED on a revealed card** — the notice sits INSIDE the one `role="status"`, so a provisional-to-final change is read out with no second region anywhere. The notice is `text-fg-secondary`, **never `text-warning`** (it is progress; the amber must keep meaning "unconfirmed"), and it is a token, never an opacity modifier. Its line is **reserved with `min-h-lh` in all three year-number states** — empty and `aria-hidden` on a final `high` — because the reveal is a `justify-center` column, so a line that vanished when a provisional year was confirmed would recentre the face at the moment the player is reading it. A provisional `low` card shows "Confirming year", not "Unconfirmed year": one slot, one notice. **Do not add one to `CardHiddenSide`, to `CardStack`'s backs, or to the HUD** beyond the `role="status"` already on the count; `CardHiddenSide.test.tsx` asserts the absence. If you are about to file the reveal's region as a leak, you are reasoning from the rule without its mounting condition.
- **Never put secrets in `api/` source** — the Vite dev server serves it as readable text.

**Environment variables** — reference in [`docs/api.md`](./api.md), annotated in `.env.example`

- **The provider vote added NO variable (2026-09-30).** Deezer and iTunes are keyless public search APIs, the iTunes storefront (`ITUNES_STOREFRONT = 'ES'`) is a constant in `api/_lib/itunes.ts`, and there is no Discogs variable because there is no Discogs. Do not add one "for later".
- **`MUSICBRAINZ_USER_AGENT` is SKIPPED WITH A WARNING on the staged path and still a LOUD 500 on the stage-less one**, and that asymmetry is the one rule applied to two paths (see the provider-vote block). Unset, `?stage=` leaves MusicBrainz out of the vote, lists it in `skipped` and warns once per cold start — and its batched read still uses `mbyear:` answers already cached, where the legacy path answers 500 even for warm tracks. Set it in development and production all the same; it is sent to a third party on every lookup, so it carries a real contact address.
- **`UPSTASH_REDIS_REST_URL` / `_TOKEN` now back THREE gates and TWO caches**: `mbgate:v1` (1.1 s), `deezergate:v1` (120 ms) and `itunesgate:v1` (3 s), all with a 1.5 s maximum wait, plus the `mbyear:` year cache and the `yearprov:` provider-answer cache. The gates are global rather than per client because every request leaves from Vercel's shared egress IPs, so a provider's per-IP limit is a limit across all players. Production only: without it everything falls back per instance and logs so once. Under `vercel dev` that means `verify` finds none of `resolve`'s answers and re-asks every provider, and iTunes gets unpaced traffic from your own IP (it answers excess with 403s).

**No Spotify credentials exist or are needed.** Spotify's Feb 2026 API changes mean no credentialed path can serve "anyone with a public link", so the app reads the public embed endpoint anonymously. Before adding a `SPOTIFY_CLIENT_ID`, read [`docs/plans/plan.md`](./plans/plan.md) §2 — **it is a product decision, not an oversight.**

**The embed payload has NO "added by" field, and that has now been spiked twice — do not spike it a third time.** Phase 0 enumerated the track-level field union; the re-spike on 2026-08-06 did it again against one editorial and one user-owned playlist, both identity-confirmed by `entity.uri` **and** `entity.name`, and found the same 15 fields with no attribution field of any shape (`authors` at playlist level is `null`). `plan.md` §5's Phase 8 item is therefore **resolved as won't-build**, and its one re-open condition is §2's no-credentials decision above, not the payload — `added_by` exists only on the Web API's `items`, which neither Client Credentials nor an anonymous caller can read. If you need to check anyway, the five-step re-run procedure is in [`docs/agent_findings.md`](./agent_findings.md) (2026-08-06); **do not add an optional `addedBy` to `Card` "for later"**, and do not build a UI against the absent field.
