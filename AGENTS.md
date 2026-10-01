# AGENTS.md

Instructions for Claude Code and other agents working in this repository. **[`docs/`](./docs/) is the source of truth** — read the relevant file before changing code or configuration.

Many decisions in this repo look like mistakes and are not. This file states each one in a line; **the reasoning, the measurements and the history are in [`docs/decisions.md`](./docs/decisions.md)**, under the section named in each heading below. Read that section before changing anything it covers. Toolchain oddities are in [`docs/toolchain.md`](./docs/toolchain.md).

---

## Documentation Index

| File                                                                                               | What it covers                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`docs/decisions.md`](./docs/decisions.md)                                                         | The full reasoning behind every rule in this file, by area (moved here verbatim from `AGENTS.md` on 2026-10-01)                                                                                                    |
| [`docs/architecture.md`](./docs/architecture.md)                                                   | Components, import boundaries between `src`/`api`/`shared`, data flow, external services                                                                                                                           |
| [`docs/api.md`](./docs/api.md)                                                                     | The `api/` surface, handler conventions, environment variable reference                                                                                                                                            |
| [`docs/toolchain.md`](./docs/toolchain.md)                                                         | The two TypeScript installs, the four tsconfigs, ESLint/Prettier, pnpm and the Node pin, Tailwind, Vitest                                                                                                          |
| [`docs/development.md`](./docs/development.md)                                                     | Setup, scripts, running functions locally, tests, deploy, known limitations; §5 is the manual-verification checklist                                                                                               |
| [`docs/agent_findings.md`](./docs/agent_findings.md)                                               | Running log of discoveries and gotchas                                                                                                                                                                             |
| [`docs/review.shuffle-system.md`](./docs/review.shuffle-system.md)                                 | The shuffle review whose §8 became the hash sort                                                                                                                                                                   |
| [`docs/review.unlighthouse.md`](./docs/review.unlighthouse.md)                                     | The Lighthouse review that made the card QR an SVG                                                                                                                                                                 |
| [`docs/plans/plan.md`](./docs/plans/plan.md)                                                       | **Authoritative phase plan**, plus all Phase 0 research findings                                                                                                                                                   |
| [`docs/plans/plan.phase-1.md`](./docs/plans/plan.phase-1.md)                                       | Phase 1                                                                                                                                                                                                            |
| [`docs/plans/plan.phase-2-playlist.md`](./docs/plans/plan.phase-2-playlist.md)                     | Phase 2a — URL parsing, the embed adapter, `/api/playlist`                                                                                                                                                         |
| [`docs/plans/plan.phase-2-year.md`](./docs/plans/plan.phase-2-year.md)                             | Phase 2b — the cache, the MusicBrainz adapter, `/api/year`                                                                                                                                                         |
| [`docs/plans/plan.phase-3.md`](./docs/plans/plan.phase-3.md)                                       | Phase 3 — reducer, seeded shuffle, persistence, the progressive resolver                                                                                                                                           |
| [`docs/plans/plan.phase-4-6-card-ui.md`](./docs/plans/plan.phase-4-6-card-ui.md)                   | Phase 4 — DOM test environment, flip card, QR, card audio                                                                                                                                                          |
| [`docs/plans/plan.phase-4-6-gestures.md`](./docs/plans/plan.phase-4-6-gestures.md)                 | Phase 5 — swipe, tap-versus-drag, stacked deck, keyboard                                                                                                                                                           |
| [`docs/plans/plan.phase-4-6-screens.md`](./docs/plans/plan.phase-4-6-screens.md)                   | Phase 6 — landing, playlist client, notices, HUD, end screen, session container                                                                                                                                    |
| [`docs/plans/plan.phase-7-look.md`](./docs/plans/plan.phase-7-look.md)                             | Phase 7a — `@theme` tokens, fluid card, reduced motion, focus and ARIA                                                                                                                                             |
| [`docs/plans/plan.phase-7-robustness.md`](./docs/plans/plan.phase-7-robustness.md)                 | Phase 7b — failure codes, error boundary, chunk splits, meta tags, Lighthouse                                                                                                                                      |
| [`docs/plans/plan.phase-8-look-and-shell.md`](./docs/plans/plan.phase-8-look-and-shell.md)         | Phase 8, plan 1 — neon ring, contrast re-audit, PWA, icons. **Built**                                                                                                                                              |
| [`docs/plans/plan.phase-8-features.md`](./docs/plans/plan.phase-8-features.md)                     | Phase 8, plan 2 — share link, saved library, PDF export, audio reversal. **Built**                                                                                                                                 |
| [`docs/plans/plan.phase-8-added-by.md`](./docs/plans/plan.phase-8-added-by.md)                     | Phase 8, plan 3 — "Added by". **Resolved as won't-build**, no code                                                                                                                                                 |
| [`docs/plans/plan.multi-playlist-core.md`](./docs/plans/plan.multi-playlist-core.md)               | Multi-playlist, plan 1 — merge module, widened state, v2 storage, the link. **Built**                                                                                                                              |
| [`docs/plans/plan.multi-playlist-ui.md`](./docs/plans/plan.multi-playlist-ui.md)                   | Multi-playlist, plan 2 — landing rows, fan-out hook, container wiring. **Built**                                                                                                                                   |
| [`docs/plans/plan.year-accuracy.md`](./docs/plans/plan.year-accuracy.md)                           | The tier ladder — Singles/EPs in the top rung, the graded middle rung. **Built**                                                                                                                                   |
| [`docs/plans/plan.suggestion-multi-select.md`](./docs/plans/plan.suggestion-multi-select.md)       | Hold a suggested playlist to select it. **Built**                                                                                                                                                                  |
| [`docs/plans/plan.google-play-shell.md`](./docs/plans/plan.google-play-shell.md)                   | Google Play, plan 1 — the Bubblewrap TWA shell. **Steps 1–5 built 2026-09-19**; **frozen**, its rows run from plan 3                                                                                               |
| [`docs/plans/plan.google-play-back-button.md`](./docs/plans/plan.google-play-back-button.md)       | Google Play, plan 2 — Android back as an in-app control. **Built 2026-08-12**; **frozen 2026-09-19**, its rows run from plan 3                                                                                     |
| [`docs/plans/plan.play-store-todo.md`](./docs/plans/plan.play-store-todo.md)                       | Google Play, plan 3 — **THE ONLY EXECUTABLE GOOGLE PLAY FILE.** Steps 2, 3 and 8 built 2026-09-19                                                                                                                  |
| [`docs/plans/plan.year-fetch-rework-mb-fixes.md`](./docs/plans/plan.year-fetch-rework-mb-fixes.md) | Year-fetch rework, plan 1 — the title cleaner, failed release-group = `upstream-unavailable`. **Built 2026-09-30**; `tokenised` rung **removed 2026-10-01** with the query-ladder reorder (cache `v6`)             |
| [`docs/plans/plan.year-fetch-rework-server.md`](./docs/plans/plan.year-fetch-rework-server.md)     | Year-fetch rework, plan 2 — the provider vote, Deezer/iTunes adapters, `resolve`/`verify` stages. **Built 2026-09-30**; steps 10–11 **amended 2026-10-01**; step 15's preview smoke test outstanding               |
| [`docs/plans/plan.year-fetch-rework-game.md`](./docs/plans/plan.year-fetch-rework-game.md)         | Year-fetch rework, plan 3 — provisional years, `keepYearless`, the two-lane resolver, the PDF gate. **Built 2026-09-30**; step 4's deferred pass **reversed 2026-10-01**; step 11's preview smoke test outstanding |
| [`docs/plans/plan.year-fetch-rework-ui.md`](./docs/plans/plan.year-fetch-rework-ui.md)             | Year-fetch rework, plan 4 — the provisional-year slot, the picker's deal options, three-language copy, the blank PDF year. **Built 2026-09-30**; step 10's preview checks outstanding                              |
| [`docs/spikes/spike.year-fetch-rework.md`](./docs/spikes/spike.year-fetch-rework.md)               | Why 21% of cards got no year, what other providers recover, which providers a paid app may use. **Measured 2026-09-29/30**; Discogs dropped (§13.12)                                                               |
| [`docs/spikes/spike.ai-year-fetch.md`](./docs/spikes/spike.ai-year-fetch.md)                       | LLM year lookup (`gemini-3.8-flash` / `gpt-6-luna`): fast and licence-clean, **but wrong on 40 of 40 tracks past its cutoff**. Nothing built                                                                       |

## Status

**Do not build ahead of the current phase.** Phases 1–8 are code complete. The work after them is the **year-fetch rework**, four plans built in order (`mb-fixes`, `server`, `game`, `ui`) — **their status is kept in the index above and nowhere else**. Outside any plan, the developer added a welcome screen (with a printable year-cards PDF) and a left swipe that steps back, both on 2026-09-18. `src/App.tsx` is the real container. The PDF's print palette is deliberately its own (plan 2 did not wait for plan 1's redesign).

**What is left is manual verification**, and it is the project's largest gap: jsdom paints nothing, evaluates no media query, computes no layout and has no accessibility tree, so the rest needs a deployment, a printer, a phone and a screen reader. Rows in [`docs/development.md`](./docs/development.md) §5, gaps in §8. **Run the screen-reader pass over one flip first** — it is the only check on the app's only live region. [§ Manual verification outstanding]

---

## Invariants — the edits to refuse

### Copy and languages [§ Copy and languages]

- **Every sentence the player reads lives in `src/game/copy.ts`, and the rule has two ends**: a component renders it (through `useCopy()`), a test asserts against `COPY.*` (or `CATALOGUES[locale].copy.*` inside a provider). Neither may hold a literal. A value that varies is a **function** that owns its pluralisation (`COPY.hud.cardsLeft(n)`), never a template a caller assembles.
- `messages.ts` stays its own `Record<StartFailureCode, string>` — the exhaustiveness is the point. `index.html`, `src/pwa/manifest.ts` and `public/privacy.html` cannot import a runtime module; copy `COPY.app.name` into them by hand. Pure-wording assertions were deleted on purpose; do not add new ones.
- **English, Spanish and Catalan.** `COPY` is still the English catalogue and the context's default, so a test without a provider gets exactly `COPY`. `copy.es.ts` / `copy.ca.ts` are `satisfies Copy` and `messages.es.ts` / `messages.ca.ts` are `ErrorMessages`: a key or code added in English and not translated fails the typecheck. Pure modules take their copy slice as a parameter defaulting to English.
- `LocaleProvider` wraps `ErrorBoundary` from **outside** in `main.tsx`, with a guarded storage read. `<html lang>` follows the locale. The footer, the app name and the file-name prefixes are not translated. `SavedPlaylist.name` is the **base** name; a legacy ` +N more` is stripped on read against a frozen literal.
- The language selector is on the welcome screen only, **in flow** as its last section — never in a top corner (it would break the `pt-8` logo contract at 320px). No translation has been read by a native speaker; wording not the developer's is marked as an unreviewed proposal.

### Screens [§ Screens: welcome, picker, end screen, footer]

- **The welcome screen is a container flag (`hasEnteredPicker`), not a fifth status**, and `LandingScreen` still means the picker. Set by the welcome button, Exit and Home; cleared by Back; **seeded** `useState(deckLink !== null || state.status !== 'idle')`. The seed only works because `useGameSession` restores the save in `useReducer`'s **lazy initializer** — move `RESUME` into an effect and it silently reads `idle`. Every picker branch returns the one `picker` value. **No branch may check `deckLink`**; each such check reopened a real hole. No "seen it" flag in `localStorage`.
- The picker's Back is a `<button>` (there is no router), icon-only with a copy `aria-label`, disabled while loading.
- `public/year-cards-1970-2033.pdf` is **not precached** (no `pdf` in `globPatterns`), is pinned **`binary` in `.gitattributes`** (any NUL-free binary needs the same line, or `autocrlf` corrupts it), and `vite.config.ts` denylists `/\.pdf(\?|$)/` from the SPA fallback. None of that is observable under a dev server.
- The "1970–2033" range lives only in the download's `download` and `href` attributes. The shared `auditable-text` fixture audits both, and `WelcomeScreen.test.tsx` subtracts the strings exactly — a new home for the range needs a new subtraction.
- The decorative welcome card is the one `card-ring` caller that is not `absolute inset-0`, so it carries `relative`, `rounded-card`, `aria-hidden`, and draws a `?`. The download link gets `focus-visible:focus-ring` and `touch-target` by hand, and no `target="_blank"`.
- **Welcome and picker both use `pt-8`, one number pinned at each end**, because the logo must sit at exactly the same height. On the picker, `text-sm` goes on caption `<span>`s, never on a `<label>` (preflight's `font: inherit` would shrink the input). The `<main>` gaps are deliberately different (`gap-8` / `gap-10`).
- The end screen's second button is **"Home"**.
- **The footer is on every screen except the crash screen**: `absolute inset-x-0 bottom-8` inside a host carrying `relative pb-20` — one number split in two, both asserted per screen. Never `mt-auto` (it beats `justify-center`), never `fixed`, never a `contentinfo` role. Leak proxies subtract `COPYRIGHT_NOTICE` by exact string; the author link's URL is not part of the notice, and the parts join with no separator. If the game screen's footer costs too much height, the lever is `--card-height`'s `62dvh`, not removing it.
- **An `ended` session with an empty deck goes to the picker with the `no-years-found` warning**; `deckCollapsed` is checked before `endedView`. That code lives in `messages.ts`'s `StartFailureCode`, never in the playlist client's union.

### The card [§ The card: faces, ring, QR, controls]

- **Nothing interactive inside `Card`.** The controls are in `CardControls` beside the stack, because a pointer-up inside the card is a tap that flips it.
- **The hidden face leaks nothing** — text, attributes, `aria-label`s, `alt`, live regions, the OS media session. It is the QR and nothing else; "Scan to play" is rendered by `GameScreen` below the card in the `text-fg-muted` **token** (never an opacity modifier), **always**, including while flipped, or the card jumps.
- `CardStack` renders **one** back: the next card's `CardHiddenSide`, `absolute inset-0`, no transform. `CardStack` never imports `CardRevealSide`. The track id reaching the DOM early is accepted (the QR encodes it). Every DOM test that renders a card needs `clearQrCache()` in `beforeEach`; the QR cache is read during render, never in an effect.
- **The card's QR is an SVG** (`toString({ type: 'svg' })`); `toDataURL` there is the edit to refuse. The PDF keeps `toDataURL` on purpose. Every QR test double must mock `toString` explicitly, or `Object.prototype.toString` returns garbage and the suite stays green.
- **The card is square** (`--card-width: var(--card-height)`); the clamp terms, `--qr-display-size` and the control sizes are derived from each other. `--ring-width` is deliberately not derived. `--container-content` and the card's ceiling agree at 24rem only — they are not mergeable.
- **The control row is `w-(--card-width)` with `justify-evenly`, and a `gap-*` there is a regression.** Its `aria-label` list is asserted exactly (`['Exit game', 'Play', 'Keep this deck']`). The icons are inline SVG sized by `--size-control-icon`. The share glyph is `filled`, so its two link paths must carry `fill="none"`.
- **The neon ring is two `@utility` composites in `src/index.css` (`card-ring`, and `card-ring-quiet` on the back), not a component, and neither may declare `position`** — the caller is positioned, pinned at both ends. The ring does not animate. The back's bloom is suppressed through a custom property, never a competing `box-shadow`. `--color-fg-year` stays separate from `--color-ring-from`, and the year stays flat, not a gradient (a failed `background-clip: text` paints it invisible).
- `Spinner.tsx` is the only spinner (its `data-motion` hook is what reduced motion hides); it takes only `sizeClassName`. A caller keeps everything the spinner means in text beside it, and puts it in a fixed-size box when it is the only thing in its container.
- **`Card` accepts a `ref`, and `AnimatePresence mode="popLayout"` silently does nothing without it.**
- The logo master is `visual-assets/logo-master/`, **never `public/`**; never put a large icon in the favicon slot; derivatives have their black raised to `--color-page`.

### Gestures and deck animation [§ Gestures and deck animation]

- A right swipe advances, **a left swipe (and ArrowLeft) steps back**; the mapping is `swipeIntent` in `gestures.ts`. `PREVIOUS` is a reducer action; on card 1 it returns the **same state object** (no end, no wrap). The flip resets on a step back. Audio stops on card id, so do not add a second stop.
- The animation is derived from the index delta: `deckMovementFor` returns `'forward' | 'backward'`, latched in `CardStack`. **The exit reads `AnimatePresence custom`, the entrance reads a plain prop, and neither can use the other's channel.** `initial={false}` silences only the session's first card.
- **Both exits name a z-index**: forward `ABOVE_INCOMING_Z_INDEX` (1, below the peek's `z-10`), backward `-1` (above the `-z-10` preload). Neither may become a bare `0` — `perspective-distant` makes a stacking context where ties go to tree order. Both use `transition: { zIndex: { type: false } }`.
- **Equal speed, not equal duration**: `TRAVEL_SPEED_PX_PER_S` is derived from existing constants and `TRAVEL_DURATION_S` covers both full-distance journeys; `EXIT_DURATION_S` keeps its three short callers. Nothing is written down; the lever is the speed.
- **The step back is performed by the finger**: the top card never moves left of its origin (`dragElastic` is 0 except `right: 0.35`), and leftward travel moves the previous card in from the right one for one (`previousCardProgress`). The peek parks one card-width out, not at 600; its position and `display` are both `MotionValue`s (`display`, never `opacity`/`visibility`, or the page scrolls sideways); the card width is read once per gesture.
- **The handoff breaks silently**: `onPrevious(fromProgress)` is recorded against the returning card's presence key and spent as `initial.x` in the same render-phase guard that latches the movement, cleared on the first other card change. Letting it merely go stale was a real bug. The peek is the stack's last child with `z-10`.
- Gesture decisions go in `gestures.ts`, binding in `useCardGestures` (jsdom cannot drag). Its tests assert configuration and payloads, never a simulated drag; a `useTransform` output needs `waitFor`. `LONG_PRESS_DURATION_MS` (500) must stay above `TAP_MAX_DURATION_MS` (400). Nothing here has been felt by a thumb.

### The game session [§ The game session]

- **The song keeps playing when the card is flipped**; audio stops only on a card change and a confirmed Exit. It **pauses** (not stops, no auto-resume) on `visibilitychange` when hidden. Never set `navigator.mediaSession.metadata`.
- **Exit goes through `ExitConfirmDialog`** (Keep playing / Restart game / End game). **Guard 4** in `GameScreen` suspends the window key handler while any dialog is open — it is an OR over the dialog flags, and a new dialog must join it. A restart usually leaves `GameScreen` mounted, so `handleRestartConfirmed` closes the dialog and stops audio by hand, and `CardStack` is keyed on `seed`.
- The preparing screen shows **no count** (`resolvedCount` stays exported, rendered nowhere).
- **`ErrorBoundary` is the only class component**, wraps `<App />` from `main.tsx`, and its fallback **never renders the error's message or stack** (its state is a boolean) — "show the error so players can report it" turns it into a spoiler. No footer under its `role="alert"`.

### Decks, links, library, shuffle [§ Decks: playlists, selection, links, library, shuffle]

- **A deck is 1..5 playlists**; merge, dedupe and labels are `deck-merge.ts`. The v1 lifts on both storage keys are load-bearing. The library caps ids on read; a stored session does not. **A link over the cap is rejected, never truncated.** The picker's "+" is unmounted at `MAX_DECK_PLAYLISTS` (the cap hint stays); a failed playlist and the combined deck are notices, never blockers; the HUD, end screen, PDF filename and library row all read one `deckLabel()`; a suggestion or saved deck pressed with nothing selected submits at once and replaces the typed rows.
- **The suggestion selection is derived from the rows, never stored** — a `Set` in state breaks it. A press with nothing selected still deals immediately; a hold, a modifier (the keyboard's only route) or "something is already lit" selects. Selection mode is scoped to the suggestions. **`consumeLongPress()` must stay first in the button's `onClick`.** The ✕ renders beside a lone filled row.
- **The shuffle is a hash sort with one algorithm and no version.** A link's `v` param is ignored, never rejected; a save with `shuffleVersion` still loads. The output is pinned as literals in `shuffle.test.ts` — a failing pin is fixed by **reverting**, and a new algorithm must bring a version back.
- A mid-game link carries `&card=<trackId>` (`START.startCardId`, `GameState.startIndex`). **`linkArrivalIntent` decides deal / resume / ask once, at mount**; `ReplaceSessionPrompt` is its own branch before the status switch, never an overlay; "Play the shared deck" replaces the saved game only when the new deck lands. Declining is not remembered.
- **A link promises "same playlist, same shuffle", never "the same deck".** A malformed link is the plain welcome screen with no error. `App.tsx` never touches the address bar. The link effect has **no "already submitted" ref** (StrictMode's cleanup would strand it).
- **The suggested playlists' years are preloaded in `src/game/preloaded-years.json`** (by track id), stamped on the merged deck's pending cards in `usePlaylist`, and loaded by **dynamic import** (static, it adds 170 kB to the entry chunk). **Never regenerate or edit that file on your own initiative — ask the developer first**, or do it when they ask; `pnpm preload-years` asks only for missing tracks and never overwrites a `manual` entry.
- **`playlist-library.ts` rebuilds an entry field by field on write as well as on read** — a spread would leak extra fields onto a pre-start surface. The first suggestion is labelled "Jitster official" on read through `playlist-display-name.ts`.

### Deck actions and the PDF export [§ Deck actions and the PDF export]

- **Share, save and print are reachable mid-game** through `DeckActionsDialog`. `DeckActions` is shared by both screens, renders only counts, and is tested once in `DeckActions.test.tsx`.
- **The PDF waits for the year crawl; the link and the save do not.** The wait is **derived** (`hasAskedToPrint && pendingYearCount > 0`), never a stored flag cleared by an effect; the auto-export still needs `hasAutoExportedRef`. Provisional cards count as pending and are never printed. `selectPrintableCards` requires its options.
- **"Print so far" is the gate's informed version**: it does not touch `hasAskedToPrint` (two files is the behaviour), its "N cards left out" line is the whole disclosure — do not weaken it — `role="status"` sits on the two sentences, not the wait's outer div, and focus lands on Cancel.
- **Print always opens the print view.** "Leave unconfirmed years blank" is local state, default off, not remembered, passed per export (`printedYear` in `pdf-sheet.ts`), and not offered when the session already skips unconfirmed years. The host passes `renderHeading(view)`.
- **The printed card is 48.9722 mm in a 4 × 4 grid, matching the year-cards PDF** — narrowing it back to 65 mm is the edit to refuse. `CARD_SIZE_MM` is derived from the margin; the duplex mirror is asserted as `xFront + xBack === PAGE_WIDTH_MM - CARD_SIZE_MM`; the template's page order must not be copied; every back millimetre lives in `backLayout()`. `COPY.deckActions.sheetSummary` imports `CARDS_PER_SHEET` (the one import in `copy.ts`). Nothing has been printed.

### Deal options [§ Deal options]

- **"Deal cards with no year found" (unticked by default) is `keepYearless`; "Deal cards with an unconfirmed year" (ticked by default) is `!skipUnconfirmed`.** The stored model never inverted; the one inversion is in `App.tsx`. Renaming the stored fields to match the labels is the edit to refuse.
- Both rules are one function, `isDroppedAnswer`, at `START`, `YEAR_RESOLVED` and `RESUME`. **A provisional year is never dropped by `skipUnconfirmed`** (Restart re-deals through `START`). The card-1 gate is skipped only when nothing can be dropped (`keepYearless && !skipUnconfirmed`).
- Remembered under `jitster:prefs:v1` by `prefs.ts`: validated per field on read, rebuilt field by field on write. **New deals use the recipient's prefs; Restart and Play again use the session's; a resume uses the save's.** A link never carries the sender's choice. The PDF reads the session's `keepYearless`.
- `OptionCheckbox`: `touch-target` on the label, the focus ring on the input, `text-sm` on the caption span, no `aria-label`, no `value` (the leak audit reads it).

### Year resolution: MusicBrainz [§ Year resolution: MusicBrainz]

- **Singles and EPs count toward `high`** — narrowing back to Album reintroduces the bug. Widening cannot overshoot because earliest-wins runs after the filter. The three-rung ladder is free (same pool, two requests). `isOfficialOriginalRelease` is the one predicate shared with `api/_lib/musicbrainz.ts`. The 50-id cap sorts Album → EP → Single before truncating. `YEAR_CACHE_SCHEMA_VERSION` is `v6`; a change that alters cached answers needs a bump.
- The title cleaner reads the **last** trailing segment first and falls back to the lazy pattern, so it never strips less than before.
- **The query ladder is duration-bounded → artist-guess → unbounded full artist.** Putting the unbounded full-artist query before the guess is the edit to refuse. The `tokenised` rung is gone.
- **Every permit after the lookup's first spent request** (later rungs, the release-group request, the remix fallback) waits up to `SPENT_LOOKUP_MAX_WAIT_MS` and then returns `upstream-unavailable` — never `rate-limited`, never a silent degrade.
- **"Personal Jesus" is pinned wrong on purpose**: resolution is recording-scoped, and fixing it needs work-level resolution. Loosening a filter reasons about the wrong entity.
- **Confidence is the weaker of the rung and the artist match** (`maxConfidence` is a ceiling). The loose artist rule is a fallback only when the exact rule admits nothing — merging the two into one filter is the change that breaks it. `artistMatchesExact` is exported for one guard test; the accuracy suite cannot check the artist rule.

### Year resolution: the provider vote [§ Year resolution: the provider vote]

- The plan is two constants in `shared/year-providers.ts`: `YEAR_PROVIDER_PLAN` (Deezer in parallel with MusicBrainz at `resolve`, then iTunes at `verify`) and `UNCONFIRMED_TRUST`. A reorder edits those plus the registry in `api/year.ts`. **Discogs is absent by decision.**
- **Two agreeing providers confirm a year, and nothing more is asked.** Deezer's two dates are **one** voter; Deezer and iTunes are **two** — counting the stores as one is the edit to refuse. Accepted errors are pinned on purpose (Personal Jesus 1990, Pink Panther 2006).
- **Lone answer order: MusicBrainz `high` > iTunes > MusicBrainz `low` > Deezer** (Deezer only when its release year equals its ISRC year). Moving iTunes above a MusicBrainz `high` is the edit to refuse.
- The year is the **recording's**; the one exception is a `Re-Recorded` title, which resolves to the original. `finalWhenCertain` is off for all three. **`isrcYear` has no 1986 floor**, and adding one is the edit to refuse.
- **Every provider is skippable with a warning; only "all of them" is the loud `not-configured` 500.** A transient failure is never a final "no year". A partial failure beside an answer is a 200 with `final: false`, never a 502. `busy` is a 429, except a `resolve` with an answer in hand (a 200 carrying `retryAfterMs`); `verify` keeps the 429. A non-final answer built on a failure or a busy provider is `Cache-Control: no-store`.
- `verify` re-runs `resolve`'s frontiers, reading their answers from Redis, never from the client. Each provider is cached on its own (`yearprov:<provider>:v1:`, MusicBrainz under `mbyear:`, never wrapped); there is no cached final vote. A store lookup with no `durationMs` sends no request and is never written.
- **The stage-less `/api/year` is the old MusicBrainz-only path, byte for byte, with its loud 500** — for tabs still on the old client. Do not make the two paths match.
- Handler tests live in `api/_lib/year-endpoint.test.ts` (a test beside the handler would deploy as a function). `store-http.ts` is the one gated GET both stores share; adapters never throw. **Busy is retried with no cap** (Deezer 700 or 429, iTunes 429); **refused is a skip** (iTunes 403, Deezer code 4). Licences: Deezer and iTunes may not be used in a paid app; MusicBrainz needs a plan or a mirror.

### Year resolution: provisional years and the resolver [§ Year resolution: provisional years and the client resolver]

- `Card.yearProvisional` is only `true`, only beside a numeric year, written only by the reducer; **`yearStateOf(card)` is the one reading** (pending / provisional / final). It lives on the card because Restart re-deals. There is no provisional null, and **a provisional answer never downgrades a final card**.
- **The resolver runs two lanes, one request in flight per stage**, under one `AbortController`. A 429 sleeps only its lane; the resolve lane also sleeps on a non-final 200 carrying `retryAfterMs`. Do not parallelise a lane, and do not skip MusicBrainz in `verify`.
- Stage state is seeded from the deck — a resumed provisional card goes straight to verify — and `persistence.ts`'s `validateCard` copies `yearProvisional` only as `true` beside a numeric year. Both are places a provisional card could silently become final.
- Verify picks the current card, then the nearest within `VERIFY_LOOKAHEAD_CARDS` ahead, then FIFO; it waits on a promise, never a timer, and `prioritize()` remembers the urgent card.
- **An exhausted resolve hands the card to verify.** An exhausted verify settles final: `yearUnverified` ("Year could not be checked") if no verify ever answered with a year, otherwise an ordinary unconfirmed `low`; `yearVerifyAnswered` is saved so a reload keeps the difference. **Merging "unchecked" into "unconfirmed" is the edit to refuse** — it deletes cards for a network blip.
- **The year selectors disagree on purpose**: `isCurrentYearPending` is "year undefined", `pendingYearCount` counts provisional cards too. Nothing in production reads `isCurrentYearPending`; do not wire it back.

### PWA and `index.html` [§ PWA, service worker and index.html]

- `vite-plugin-pwa` in `generateSW` mode. **It precaches the build output only — `runtimeCaching` is empty on purpose** — and **it waits instead of calling `skipWaiting`** (a mid-game activation strands code-split chunks). No `devOptions`. The manifest is `src/pwa/manifest.ts`, imported only by `vite.config.ts`.
- **Comments in `index.html` are shipped bytes.** `theme-color` tracks `--color-page` by hand. The favicon is a small WebP; never restore a large icon.

### Google Play [§ Google Play: the back press and the TWA shell]

- **Execute only from `plan.play-store-todo.md`**; the shell and back-button plans are frozen.
- **The Android back press is an in-app control**: `GameScreen` calls `useBackNavigation`, which holds the app's **only `pushState`**. Back is a request, never an exit; mounting is the scoping; the entry is replaced after every press; the cleanup removes the listener **before** navigating (pinned as a call order). `history.length` is not an instrument. `App.tsx` stays untouched. Do not delete that `pushState` because `App.tsx` never touches the address bar.
- **`android/` exists locally since 2026-09-20, and only `android/twa-manifest.json` is tracked.** Everything else in it is Bubblewrap output, the keystore or a build artefact; `.gitignore` names those paths one at a time and **never widens to `android/`**; SDK bumps go in `twa-manifest.json`, because `bubblewrap update` regenerates `app/build.gradle`.
- **`@bubblewrap/cli` is installed with `npm i -g` and never enters `devDependencies`.** The keystore is never committed; leaking an upload key is the unrecoverable direction.
- **The application id (`aleixrabassa.playlistjitster`), `manifest.id` and `start_url` are permanent after the first publish** — changing one installs a second app with no error. `id` is written out explicitly and pinned by tests, including across `android/twa-manifest.json`.
- **The TWA shares `localStorage` with the browser by design**; do not namespace the keys per launcher.
- **The origin `https://playlistjitster.vercel.app` is permanent.** `assetlinks.json` is not precached; `vercel.json`'s rewrite must keep its `[^.]*` dot exclusion; the fingerprint list holds only the upload key today — step 11 **adds** Play's key beside it and never replaces it.

### The name [§ The name and the rename boundary]

- The app is **"Playlist Jitster"**, and internal identifiers say `jitster` (the `localStorage` keys `jitster:session:v1`, `jitster:library:v1` and `jitster:locale:v1` replaced `hitster:*` with **no migration**, on purpose; a renamed key is not read). **Never rename a "Hitster" that means the board game.** Not this repo's to rename: the checkout directory, the Vercel project, the old alias, the fixtures' provenance comments. `docs/plans/` and old findings keep old names as history. The first suggestion is "Jitster official" with its id unchanged, and every row is guarded against the mark. No check in this repo has ever opened an image.

### Local development [§ Local development and test fixtures]

- **The app is only playable under `npx vercel dev`, never `pnpm dev`** — the `unexpected-payload` error there is correct behaviour.
- The fixture harness and `public/dev-preview.wav` are gone; to look at one card shape, run a component test in watch mode. The fixture deck is `src/components/__fixtures__/cards.ts`.

---

## Key Rules

**Layout and imports** — details in [`docs/architecture.md`](./docs/architecture.md) §2

- `src/` = browser (may use the `@/` alias and DOM APIs) · `api/` = Node · `shared/` = both, so **no DOM and no Node APIs**. New files must land in the right tree, because that decides which typecheck config covers them.
- **`src/` has four subtrees**: `src/game/` = the session, pure and framework-free (reducer, shuffle, resolver, persistence, gesture _decisions_, the clients, the copy); `src/components/` = presentational React, props in and callbacks out; `src/hooks/` = stateful concerns (audio, gesture _binding_, requests); `src/components/__fixtures__/` = the shared fixture deck. `src/game/browser-storage.ts` (the guarded `localStorage` read) is the one other non-pure file in `src/game/`, on purpose. Logic accumulating in a component belongs in a hook or in `src/game/`.
- **`shared/` holds the decision half of the year vote** (`year-providers.ts`, `store-match.ts`, beside `year.ts`), node-tested with no HTTP; the binding half is `api/_lib/` (`year-pipeline.ts`, `provider-lookup.ts`, `deezer.ts`, `itunes.ts`, `store-http.ts`, `musicbrainz-provider.ts`). A vote rule growing in the driver belongs in `shared/`. `store-match.ts` deliberately does not use `artistMatchesExact`; its mutation guard lives in `api/_lib/year-votes.test.ts`.
- **`src/App.tsx` is the only caller of `useGameSession()`** and the only file that knows all four statuses. `dispatch` is not exposed: a screen that needs a new transition gets a reducer action with its tests.
- **Both HTTP clients live in `src/game/` and take an injected `fetch`**, with a thin hook over each, so every status branch is a node unit test.
- **The decision/binding split is the house style** because jsdom cannot exercise a drag or a layout: thresholds and comparisons go in pure modules (`gestures.ts`, `resolver.ts`, `pdf-sheet.ts`, `deck-link.ts`, `playlist-selection.ts`), and hooks only collect and dispatch.
- **`api/` imports `shared/` by relative path, never `@/`** — an aliased import type-checks and fails at deploy time. `api/hello.ts` is the minimal handler, `api/playlist.ts` the reference for a real one.
- **Every relative runtime import that can reach a function bundle ends in `.js`** (all of `api/`, and `shared/`→`shared/`). Getting it wrong is `FUNCTION_INVOCATION_FAILED` at runtime after a clean build, and every local check passes either way.

**TypeScript** — details in [`docs/toolchain.md`](./docs/toolchain.md) §1–2

- **Two TypeScript installs exist on purpose.** `typescript` (6.0.3) is there only so `typescript-eslint` can load; `typescript-7` (7.0.2) is the real compiler. Don't delete either, don't flip which one is aliased.
- **Never call bare `tsc`** in a script — invoke compilers by explicit path.
- **Root `tsconfig.json` must never become a solution file** (`files: []` + `references`): Vercel reads it to compile `api/`, and that breaks at deploy time only. No `references`, no `composite`; `build` never becomes `tsc -b && vite build`.
- No `baseUrl` (removed in TS 7); `paths` targets must be relative.

**Conventions**

- **Never regenerate the visual assets on your own initiative** — `visual-assets/` and the icon set derived from the logo master change only when the developer asks. A change that makes a screenshot stale is a reason to tell the developer.
- **pnpm only**; keep `pnpm-lock.yaml`. The one exception is `@bubblewrap/cli`, installed with `npm i -g`.
- **`engines.node` is `24.x` and deliberately does not match local Node.** The `Unsupported engine` warning is expected.
- **Prettier owns formatting.** No hand-formatting, no stylistic ESLint rules.
- **The copy surface is `src/game/copy.ts`** (see Copy and languages above).
- **Tailwind v4 is CSS-first** — no `tailwind.config.js`. **The design surface is the `@theme static` block in `src/index.css`**: a component consumes tokens, never literals like `bg-neutral-900`. Every interactive element gets `focus-visible:focus-ring`. Use **`@theme static`, never bare `@theme`**, which tree-shakes tokens used only through arbitrary values, `@utility` or the reduced-motion block.
- **An unknown Tailwind colour utility is a silent no-op** and all four checks pass. When adding or renaming a token, grep `dist/assets/*.css` for the utility and assert the class name in the component's test.
- **Vitest's default environment is `node` and stays that way**; a DOM test opts in per file with a `/** @vitest-environment jsdom */` docblock as its first line.
- **Testing Library does not clean up here** (no Vitest `globals`): every DOM test file needs its own `afterEach(cleanup)`.
- **`CardRevealSide`'s live region is the one place announcing track data is correct**, because `Card` mounts it only while flipped. It also announces "Confirming year" and a year `verify` changed, inside the same `role="status"`. That notice is `text-fg-secondary`, never `text-warning`, and its line is reserved with `min-h-lh` in every state so the face never recentres. **Do not add a live region to `CardHiddenSide`, `CardStack`'s backs or the HUD.**
- **Never put secrets in `api/` source** — the Vite dev server serves it as readable text.

**Environment variables** — reference in [`docs/api.md`](./docs/api.md), annotated in `.env.example`

- **The provider vote added no variable**: Deezer and iTunes are keyless, the iTunes storefront is a constant. Do not add one "for later".
- **`MUSICBRAINZ_USER_AGENT` is skipped with a warning on the staged path and a loud 500 on the stage-less one** — one rule applied to two paths. Set it everywhere; it carries a real contact address.
- **`UPSTASH_REDIS_REST_URL` / `_TOKEN` back three global gates** (`mbgate:v1` 1.1 s, `deezergate:v1` 120 ms, `itunesgate:v1` 3 s) **and two caches** (`mbyear:`, `yearprov:`). Without them everything falls back per instance: under `vercel dev`, `verify` re-asks every provider and iTunes may answer with 403s.
- **No Spotify credentials exist or are needed** — the app reads the public embed endpoint anonymously. Adding a `SPOTIFY_CLIENT_ID` is a product decision; read [`docs/plans/plan.md`](./docs/plans/plan.md) §2 first.
- **The embed payload has no "added by" field**, spiked twice — do not spike it again, do not add an optional `addedBy` to `Card`, do not build UI against it. Re-run procedure in [`docs/agent_findings.md`](./docs/agent_findings.md) (2026-08-06).

**Before committing:**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass. There are no pre-commit hooks and no CI — the checks are yours to run.

---

## Findings

Append discoveries, gotchas, implicit conventions, and non-obvious behaviours to [`docs/agent_findings.md`](./docs/agent_findings.md).

- **Always date each entry** (ISO 8601).
- **Record conclusions from any significant analysis** — if you traced an error or explored an unfamiliar area, write down what you learned so a future session doesn't repeat the work.
- **Tell the user** when you add a finding.
- **Confirm with the user first** before editing or removing an existing entry.
- **When a decision changes, update its one line here and its block in [`docs/decisions.md`](./docs/decisions.md)** — the line is what every session reads; the block is the why.
