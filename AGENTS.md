# AGENTS.md

Instructions for Claude Code and other agents working in this repository. **[`docs/`](./docs/) is the source of truth** — read the relevant file before changing code or configuration.

Several decisions in this repo look like mistakes and are not. If something seems obviously wrong, check `docs/toolchain.md` before "fixing" it.

---

## Documentation Index

| File                                                                                       | What it covers                                                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [`docs/architecture.md`](./docs/architecture.md)                                           | Components, import boundaries between `src`/`api`/`shared`, data flow, external services, planned phases     |
| [`docs/api.md`](./docs/api.md)                                                             | The `api/` surface, handler conventions, environment variable reference                                      |
| [`docs/toolchain.md`](./docs/toolchain.md)                                                 | The two TypeScript installs, the four tsconfigs, ESLint/Prettier, pnpm and the Node pin, Tailwind, Vitest    |
| [`docs/development.md`](./docs/development.md)                                             | Setup, scripts, running functions locally, tests, deploy, known limitations                                  |
| [`docs/agent_findings.md`](./docs/agent_findings.md)                                       | Running log of discoveries and gotchas found while working here                                              |
| [`docs/plans/plan.md`](./docs/plans/plan.md)                                               | **Authoritative phase plan** — what belongs in which phase, plus all Phase 0 research findings               |
| [`docs/plans/plan.phase-1.md`](./docs/plans/plan.phase-1.md)                               | Phase 1 detail, decisions, and execution notes                                                               |
| [`docs/plans/plan.phase-2-playlist.md`](./docs/plans/plan.phase-2-playlist.md)             | Phase 2, first half — URL parsing, the embed adapter, `/api/playlist`                                        |
| [`docs/plans/plan.phase-2-year.md`](./docs/plans/plan.phase-2-year.md)                     | Phase 2, second half — the cache, the MusicBrainz adapter, year resolution, `/api/year`                      |
| [`docs/plans/plan.phase-3.md`](./docs/plans/plan.phase-3.md)                               | Phase 3 — the reducer, seeded shuffle, persistence, and the progressive-loading resolver                     |
| [`docs/plans/plan.phase-4-6-card-ui.md`](./docs/plans/plan.phase-4-6-card-ui.md)           | Phase 4 — the DOM test environment, the flip card, the QR code, and card audio                               |
| [`docs/plans/plan.phase-4-6-gestures.md`](./docs/plans/plan.phase-4-6-gestures.md)         | Phase 5 — swipe, tap-versus-drag, the stacked deck, keyboard controls                                        |
| [`docs/plans/plan.phase-4-6-screens.md`](./docs/plans/plan.phase-4-6-screens.md)           | Phase 6 — landing, the playlist client, notices, the HUD, the end screen, the session container              |
| [`docs/plans/plan.phase-7-look.md`](./docs/plans/plan.phase-7-look.md)                     | Phase 7, first half — the `@theme` token layer, the fluid card, reduced motion, focus and ARIA               |
| [`docs/plans/plan.phase-7-robustness.md`](./docs/plans/plan.phase-7-robustness.md)         | Phase 7, second half — failure codes, the error boundary, the chunk splits, the meta tags, Lighthouse        |
| [`docs/plans/plan.phase-8-look-and-shell.md`](./docs/plans/plan.phase-8-look-and-shell.md) | Phase 8, plan 1 — neon-ring card design, contrast re-audit, PWA, icon set. **Built**                         |
| [`docs/plans/plan.phase-8-features.md`](./docs/plans/plan.phase-8-features.md)             | Phase 8, plan 2 — the share link, the saved-playlist library, the PDF export, the audio reversal. **Built**  |
| [`docs/plans/plan.phase-8-added-by.md`](./docs/plans/plan.phase-8-added-by.md)             | Phase 8, plan 3 — the "Added by" decision. Writes no code; resolved as won't-build                           |
| [`docs/plans/plan.multi-playlist-core.md`](./docs/plans/plan.multi-playlist-core.md)       | Multi-playlist, plan 1 — the merge module, the widened state, both v2 storage formats, the link. **Built**   |
| [`docs/plans/plan.multi-playlist-ui.md`](./docs/plans/plan.multi-playlist-ui.md)           | Multi-playlist, plan 2 — the landing rows, the fan-out hook, the container wiring, the labels. **Not built** |
| [`docs/plans/plan.year-accuracy.md`](./docs/plans/plan.year-accuracy.md)                   | The tier ladder — Singles/EPs in the top rung, the graded middle rung, the re-captured fixtures. **Built**   |

**Do not build ahead of the current phase.** The plan defers things deliberately. Current phase: **8, CODE COMPLETE.** Phases 1–7 are complete, all three Phase 8 plans are resolved, and the app is playable end to end, has a design surface, is installable, and fails legibly. `src/App.tsx` is the **real container** and the only caller of `useGameSession()`. Plan 2 built the shareable deck URL, the saved-playlist library, the printable PDF export and the audio reversal; plan 1 built the neon ring, the contrast re-audit, the PWA and the icon set; plan 3 resolved "Added by" as won't-build with no code. Note that plan 2 depended on plan 1 only **softly** and did not wait — so the PDF's print palette is deliberately its own and did not change when the screen was redesigned.

**A DECK IS NOW 1..5 PLAYLISTS, and plan 1 of 2 is built (2026-08-07) — so the tree is green but the
FEATURE IS HALF LANDED.** Everything below React exists: `src/game/deck-merge.ts` (the merge, the
dedupe, the notice aggregation, the failure ordering, `deckLabel()` and `MAX_DECK_PLAYLISTS`),
`GameState.playlists` replacing `playlist`, both `localStorage` payloads at **v2 reading v1**, the
share link's `playlist` param as a **comma list**, and `SavedPlaylist.ids` keyed by `savedDeckKey()`.
**Nothing above React does**: `usePlaylist` still fetches ONE playlist, the landing screen still has
one input, and there is no way for a player to name a second playlist. That is
[`plan.multi-playlist-ui.md`](./docs/plans/plan.multi-playlist-ui.md), and until it lands the app
behaves exactly as it did — the whole feature is the `n = 1` case. **`App.tsx`, `DeckActions.tsx` and
`LandingScreen.tsx` carry small n=1 SHIMS, each commented as such**, because plan 1 is out of scope
for them and the four checks still had to pass; plan 2 replaces every one. The one shim with a
behavioural edge: **`App.tsx`'s link effect IGNORES a link naming several playlists** rather than
dealing its first — unreachable today, since this build's `buildDeckLink` only ever emits one id, and
dealing a deck the link did not describe is exactly what the over-cap rejection refuses to do.
**The merge lives in a pure module because a wrong dedupe or a wrong label is invisible to every DOM
test** — it reads as a duplicate card halfway through a deck, or as a slightly odd heading. Three
rules to know before touching any of it: **the v1 lifts on both storage keys are load-bearing** (drop
one and a deploy silently empties a curated library on the landing screen), **the library caps its
ids on read while a stored session deliberately does not** (the cap governs INPUT; a saved session
describes a deck that already exists), and **a link over the cap is rejected, never truncated**. Full
reasoning in [`docs/architecture.md`](./docs/architecture.md) §3, "The combined deck".

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
construction. **`YEAR_CACHE_SCHEMA_VERSION` is `v4`** — necessary, not ceremonial, because the change
alters answers cached at `high` for 30 days. And **all 22 fixtures were RE-CAPTURED**, because the
old ones carried Single candidates with no `releaseGroupFirstReleaseDate` (nothing had ever fetched
one) — so the 14-track suite passed both before and after the code change while being structurally
incapable of testing it. Measured 21 of 22 exact live.

**The twenty-second track is pinned as WRONG on purpose, and it is not a filtering problem.**
`YEAR_LIMITATION_FIXTURES` holds "Personal Jesus" at ground truth 1989 with `resolvesTo: 1990`
asserted. Year resolution is **recording**-scoped — the adapter finds recordings, then asks which
release groups they appear on — and the album version is 4:55 while the correctly-dated 1989 single
carries a **3:46 edit**, a separate recording MBID. Verified unbounded: the `dur:` bound is not what
hides it, and removing the bound would not help. Reaching it needs **work-level** resolution, which
is a much larger change. If you are about to "fix" this by loosening a filter, you are reasoning
about the wrong entity. See [`docs/plans/plan.year-accuracy.md`](./docs/plans/plan.year-accuracy.md).

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

**What is left in Phase 8 is entirely MANUAL VERIFICATION, and it is now the project's largest gap.** Nothing is waiting on a decision or on code. Everything automatable is automated, and the ceiling is genuinely low here — jsdom paints nothing, evaluates no media query, computes no layout and has no accessibility tree — so what remains needs a deployment, a printer, a phone and a screen reader. Scoped row by row in [`docs/development.md`](./docs/development.md) §5, gaps in its §8. **Run the screen-reader pass over one flip first**: it is the only check on the app's only live region, which is what makes the game's payoff audible at all, and it has now been carried by two phases without being run.

**The app is a PWA, and the service worker's two most important properties are things it deliberately does NOT do.** `vite-plugin-pwa` in `generateSW` mode; the manifest is a typed module at `src/pwa/manifest.ts` (imported by `vite.config.ts` and by nothing in the app, so it is not in the client bundle). **It precaches the build output and nothing else — `runtimeCaching` is empty on purpose**: a cached `/api/playlist` would deal a deck that no longer matches the real playlist, and `/api/year`'s freshness story is the shared Upstash cache, so a browser-local copy is a hole in that design rather than an extension of it. **And the update strategy WAITS rather than calling `skipWaiting`**, because the app code-splits `GameScreen`, the QR encoder and the PDF chunks — a worker activating mid-game after a redeploy leaves the tab requesting a chunk hash that no longer exists, so the next card is a hard failure. Two consequences to know before "improving" either: offline means the shell loads and a **saved session** stays playable minus audio and lookups, and an update lands only once every tab is closed. **`devOptions` is absent**, so neither `pnpm dev` nor `npx vercel dev` ever registers a worker. See [`docs/architecture.md`](./docs/architecture.md) §3.

**The neon ring is two `@utility` composites, not a component, and neither of them may declare `position`.** `card-ring` (both faces in `Card.tsx`) and `card-ring-dim` (the backs in `CardStack.tsx`) live in `src/index.css`. A `NeonRing` component was rejected because it would put a decorative `aria-hidden` node **inside the one subtree where "leak nothing" is a hard rule**, and give `prefers-reduced-motion` a second place to be taught about. The `position` rule is the live trap: `card-ring`'s gradient band is a `position: absolute` `::before`, so the reflex is `position: relative` on the utility — but **both call sites are already `absolute inset-0`**, the declarations would collide in one cascade layer, and if `relative` won, both card faces would drop out of absolute positioning and the card would come apart. The contract is _the caller is positioned_, pinned at both ends: `index.css.test.ts` asserts neither utility sets a `position`, and the component tests assert `absolute` beside the ring class. **The ring also does not animate** — that is deliberate, recorded in the CSS, and why the reduced-motion block still covers exactly three surfaces.

**Two Phase 8 findings that read as bugs and are not, plus one that is:**

- **The pre-`5e178f6` `public/logo.png` and the `logo.webp` that replaced it are DIFFERENT ARTWORK**, swapped in a single commit, which nothing recorded — Phase 7's note about replacing "a 1.26 MB PNG" is true about the bytes and silent about the picture. Resolved 2026-08-06 as **one identity everywhere**, then **re-resolved on 2026-08-12 against NEW developer-supplied artwork**: the master is now `docs/assets/logo.png` (1254×1254, wordmark reading "PLAYLIST JITSTER"), and `logo.webp` (**384×384, 12,892 bytes**) plus all four PWA icons are `LANCZOS` downscales of it. **The master is deliberately in `docs/`, never `public/`** — everything in `public/` ships _and_ is precached by the service worker, and a 1.2 MB master there is the same file, at the same size, that cost 6.2 s of LCP as a favicon. **Never restore a large icon to the favicon slot** — that rule is unchanged. Every derivative also has its **black floor raised to `--color-page` (#0a0a0a)**, because the artwork's backdrop is pure black and the page is not: the logo is rendered on the landing screen at 192px and a 4% luminance step across a straight edge reads as a pasted square.
- **`--color-fg-year` is a separate token from `--color-ring-from` despite sharing its value**, and the year is **flat rather than the mockup's gradient**. `background-clip: text` needs `color: transparent`, so a gradient that fails to paint renders the year _invisible_ — the same silent shape as the unknown-colour-utility bug this repo already shipped — and a gradient has no single contrast ratio to record.
- **The deck's two peeking backs do not render at all on a full-height card**, and this one is a real defect: centre-origin `scale()` lifts the bottom edge by 8.96px while `translateY` pushes it down 10px, so they peek by 1.04px and 2.08px and are inset on every other side. Pre-existing from Phase 5, measured 2026-08-06, **not fixed** — the remedy is a deck-feel decision. Consequence: `card-ring-dim` is currently inert at desktop card sizes.

**Everything plan 2 built is a caller change: the reducer, `GameState` and the persistence format are untouched.** Three new pure modules in `src/game/` (`deck-link.ts`, `playlist-library.ts`, `pdf-sheet.ts` + `pdf-text.ts`), one new hook (`src/hooks/usePdfExport.ts`), and the shared `src/game/qrcode-loader.ts`. **Which subtree each landed in was the usual decision, and the rule is "put it where it can be tested":** `deck-link.ts` takes a query STRING rather than reading `location`, `playlist-library.ts` takes an injected `StorageLike` exactly as `persistence.ts` does, and `pdf-sheet.ts` holds every millimetre as arithmetic over numbers — the same decision/binding split as `gestures.ts` and `resolver.ts`, for the same reason: **getting the duplex column mirror wrong pairs every printed card with the wrong answer and is discoverable only by printing and cutting.** The binding halves are `App.tsx`, `EndScreen.tsx` and `usePdfExport.ts`. See [`docs/architecture.md`](./docs/architecture.md) §3.

**A shared link promises "same playlist, same shuffle", NEVER "the same deck", and the copy is the feature.** Yearless cards are dropped at play time and editorial playlists refresh their tracks, so the seeded shuffle is exact while its input is not. `EndScreen.test.tsx` asserts the phrase "same deck" is absent. Also load-bearing: a **saved session outranks a link** (opening an old one must not discard a game in progress), a malformed link is the plain landing screen with **no error**, and `App.tsx` **never touches the address bar** — no `pushState`, no `replaceState`. That rule is still true **of `App.tsx`** and is not the whole story any more: see the back-press block below, and do not delete the `pushState` in `useBackNavigation.ts` on the strength of this sentence. The link effect deliberately has **no "already submitted" ref**: such a guard survives StrictMode's simulated unmount, whose cleanup has already aborted the request it was recording, so the app would sit on the landing screen forever. That is measured and written up in [`docs/agent_findings.md`](./docs/agent_findings.md) (2026-08-06).

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
no user-agent sniff. Full reasoning in [`docs/architecture.md`](./docs/architecture.md) §3; **every
device check is still outstanding** and cannot be run in Chrome.

**`playlist-library.ts` rebuilds an entry field by field on the WRITE as well as on the read, and that is a leak rule.** `SavedPlaylist` is a structural interface and TypeScript's excess-property check does not fire for a spread, so `savePlaylist(storage, { ...somethingLarger })` type-checked and wrote every extra field into a store the **landing screen** reads — a pre-start surface. Caught by the module's own leak test. **Validating only on read is not enough when the store itself is the leak surface.**

**`src/components/ErrorBoundary.tsx` is the only class component in the app, and its fallback MUST NEVER render the caught error's message or stack.** `componentDidCatch` has no hook equivalent, which is why it is a class. It wraps `<App />` from **`main.tsx`, outside it** — a boundary catches only what is below it, so one rendered inside `App` would be unmounted by the very exception it exists to catch. The leak rule is the load-bearing part: every prop in the app flows through the tree it catches and the deck is in there, so an error string can quote a track title, artist or year. State holds a **boolean, not the `Error`**, so the leak is unavailable rather than merely avoided; the detail goes to `console.error`, which is not a rendered surface. **"Show the error so the player can report it" is the natural next change and it is the one that turns a crash screen into a spoiler** — `ErrorBoundary.test.tsx` throws an error containing a fixture card's title, artist and year and asserts all three are absent.

**An `ended` session with an EMPTY deck goes to the landing screen with a warning, not to the end screen.** A card whose year lookup finds nothing is removed from the deck, so a playlist MusicBrainz cannot place drains to zero; that used to reach the end screen reading "Deck finished" over a count of **0**. `App.tsx` derives `deckCollapsed` from `status === 'ended' && deck.length === 0` — exact, because every other route to `ended` leaves the played cards in the deck — and checks it **before** `endedView`. The warning is `no-years-found`, which is why **`messages.ts` owns `StartFailureCode = PlaylistClientErrorCode | 'no-years-found'`**: the code is produced by the session, not by a fetch, and adding it to the client's own union would make that type claim a code `fetchPlaylist` cannot return. One slot, one union, no fifth view.

**Comments in `index.html` are shipped bytes**, unlike comments in `src/` — it is the blocking document on the critical path and nothing strips it. Keep the reasoning in [`docs/architecture.md`](./docs/architecture.md) §3 and one-line pointers in the file. Two literals there are load-bearing: `theme-color` **must** track `--color-page` by hand (a `meta` attribute cannot hold a `var()`), and the favicon is a 20 kB WebP that replaced a **1.26 MB PNG which was costing 6.2 s of LCP** — never restore a large icon.

**Phase 7's first half is verified only at the ends of each contract, never in the middle**, and that is a property of the environment rather than of the effort: jsdom evaluates no media queries, has **no `window.matchMedia` at all**, computes no layout, and has no accessibility-tree consumer. So a component asserts it renders a `data-motion` hook and `src/index.css.test.ts` asserts the stylesheet names it — and nothing checks that reduced motion, the responsive clamp, the focus rings or the reveal's live region actually work. Four manual passes are scoped row by row in [`docs/development.md`](./docs/development.md) §5, all Pending. **The screen-reader pass matters most:** the reveal's live region is the phase's most valuable single change (before it, a flip was silent and the year was unreachable without sight) and nothing local confirms it announces.

**The app is only playable under `npx vercel dev`, never `pnpm dev`.** Vite serves `api/playlist.ts` as transpiled source with status 200, so pressing Start under `pnpm dev` shows the `unexpected-payload` error copy ("Spotify returned something we could not read"). That is the client behaving exactly as designed, not a bug — see [`docs/development.md`](./docs/development.md) §4.

**The three controls are NOT on the card** (`src/components/CardControls.tsx`, rendered by `GameScreen` beside the stack), and putting them back would reintroduce a real bug: `gestureProps.onPointerUp` is bound to the card's outer element, so a pointer-up on a button inside the card is read as a tap and flips it — pressing Play revealed the answer. **Nothing interactive may be rendered inside `Card`.** Two tests assert the absence.

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
when it is made**, and `selectPrintableCards` drops every card without a year, so an export taken
mid-crawl prints a deck that is quietly short and the omission is discoverable only by counting
printed paper. So a press with lookups outstanding neither exports nor refuses: it shows a
preparing-screen-shaped wait and exports itself when the last year lands. Three traps. **The wait is
DERIVED (`hasAskedToPrint && pendingYearCount > 0`), never stored** — the obvious `isWaiting` flag
cleared by an effect is what `react-hooks/set-state-in-effect` rejects, and the rule is right, so
the wait ends by itself on the render where the count hits zero. **The auto-export effect still
needs `hasAutoExportedRef`**, because `hasAskedToPrint` stays true after the handoff and `deck` is a
new array identity on every resolved year. And **`excludedCount` / `nothing-to-print` are still live
branches**: the gate waits for `year === undefined`, while `selectPrintableCards` also drops
`year === null`, which only a resumed pre-reversal save holds. `pendingYearCount` is a selector
beside the reducer and is the first caller `resolvedCount` has had since 2026-08-05.

**The wait offers "Print so far", and it does not contradict the gate — it is the gate's informed
version** (2026-08-07). What the gate refuses is a deck that is **quietly** short; a player who
presses this is told the count that was left out, in "PDF downloaded — N cards left out, no year yet".
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

**The end screen's second button says "Home", not "New playlist"** (renamed 2026-08-06). The landing
screen is also where the saved-playlist library is and where a shared link is pasted, so the old
label named one of three reasons to press it — and the only one the button does _not_ do. It touched
no state, because `EndedView` was already phrased as the **destination** `'landing'` rather than as
a reason; `EndScreen.test.tsx` asserts the old label is absent.

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

**A seventh decision landed on 2026-08-06 and it reverses "the backs are empty divs", which was
written in three places: `CardStack` now renders ONE back, and it is the NEXT CARD'S HIDDEN FACE.**
The old shape was two empty divs, centre-scaled to 96% / 92% and offset 10px — and because
`scale()` is centre-origin, every edge was inset rather than peeking, so sliding the top card aside
uncovered two concentric rectangles smaller than the card. The back is now `absolute inset-0` with
**no transform**: covered pixel for pixel at rest, revealed complete the instant the card moves.
**The leak half of the old rule is untouched and still asserted** — the back mounts
`CardHiddenSide`, `CardStack` does not import `CardRevealSide`, and no title, artist or year reaches
the document a card early, in text or in an attribute. What does is the **track id**, because the QR
encodes it; that was weighed and accepted, and the cost half (one extra `toDataURL()` per advance)
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
size upscales a QR and blurs the module edges a camera reads.
`--ring-width` deliberately did **not** follow the card (a derived ring goes sub-pixel and blurs into
its own bloom). One new hazard: **`--container-content` and the card's ceiling are now both 24rem**, so
the three components capped at `--card-width` look mergeable with the reading measure — they agree at
the ceiling and nowhere else. Reasoning in [`docs/architecture.md`](./docs/architecture.md) §3.

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

**The deck-actions icon is the three-node share glyph as of 2026-08-11, and it is `filled` — so its
two link paths MUST carry `fill="none"`.** Otherwise the filled `<svg>` paints the triangle the four
link endpoints imply and the mark becomes a solid wedge. `filled` rather than the outlined default
because the reference's nodes are solid and three rings read as noise at 20px. The old export-arrow's
rationale is not wrong, it is answered — see the comment above `KeepDeckIcon`. `aria-label` is
unchanged ("Keep this deck"), and `CardControls.test.tsx` pins the shape counts and the `fill="none"`.

**There is a copyright footer, it is on THREE screens, and both omissions are the decision
(2026-08-11).** `src/components/Footer.tsx` renders on **landing, preparing and end**. There is no
shell to hang it on — every screen is its own `min-h-dvh justify-center` column, so one footer in
`App.tsx` or `main.tsx` is a sibling of a full-viewport column and gives every screen a permanent
scrollbar. **Not the game screen**: that column is a height budget (`--card-height` exists so the HUD,
card, caption and controls fit a phone) and a `mt-auto` variant is worse, because auto margins beat
`justify-center` and the card stops being centred. **Not the crash screen**: `ErrorBoundary`'s fallback
is a `role="alert"`, so its whole subtree is announced and the copyright would be read out to someone
being told the game crashed. **It is pinned to the bottom OUT OF FLOW and that is a two-ended
contract**: `Footer` is `absolute inset-x-0 bottom-4`, every host must carry **`relative` and
`pb-12`**, and each screen's test asserts both (same shape as `card-ring` — the caller is positioned).
The textbook `mt-auto` sticky footer is what this replaced and it cannot work here: **an auto margin
beats `justify-content`**, so the first `mt-auto` swallows the free space and the screen's content
stops being centred. Not `fixed` either — on the landing screen it would float over the suggestions
instead of ending the scroll. Two more traps. The `<footer>` is inside each `<main>`, so it is **not** a
`contentinfo` landmark and must not be given the role — and **Testing Library maps `footer` to
`contentinfo` regardless of ancestry**, so a role query cannot check any of this (a `toBeNull()` was
written first and failed against correct code). And its **"2026-present" is a year-shaped number on a
pre-reveal surface**: three leak proxies asserting `not.toMatch(/\b(19|20)\d{2}\b/)` caught it, and they
now subtract `COPYRIGHT_NOTICE` by exact string rather than loosening the pattern.

**The app is "Playlist Jitster" as of 2026-08-11 — and the RENAME'S BOUNDARY is the part to know.**
Renamed: `index.html`'s `<title>`, `manifest.name`/`short_name`, `LandingScreen`'s `<h1>`, README's
heading, and `pdfFileName`'s prefix (`hitster-*.pdf` → `jitster-*.pdf`, because a downloads list is
user-visible). **Never rename:** `hitster:session:v1` and `hitster:library:v1` (a renamed key is not
read, so it silently discards a saved game and a curated library); every "Hitster" that means the
BOARD GAME (`pdf-sheet.ts`'s 65 mm card, `reducer.ts` and `messages.ts` on dropping a yearless card,
`CardRevealSide`, README's "shop-bought Hitster cards") — renaming those corrupts the reasoning; and
`custom-hitster` as the package/repo name, in `MUSICBRAINZ_USER_AGENT`, in `api/hello`'s message and in
the `https://hitster.example` test origins. **The PWA ARTWORK was NOT unaffected, and this line used to
claim it was**: the icons did carry a "PLAYLIST HITSTER" wordmark — nobody opened the image, because the
rename was reasoned about as a string change. New artwork reading "PLAYLIST JITSTER" landed on
2026-08-12 and the whole set was regenerated from it, so "one identity everywhere" now holds by
regeneration rather than by the absence of a wordmark. **No check in this repo has ever opened an image.**

**Five developer decisions landed on 2026-08-05, after Phase 7 plan 1. Two of them reverse
something `plan.md` had already resolved, so read these before "fixing" the code back:**

- **A card whose year lookup finds nothing is REMOVED from the deck** (`gameReducer`, `YEAR_RESOLVED`).
  This reverses `plan.md` §6's `confidence: 'none'` follow-on, which had it stay and play. **Low
  confidence is unaffected** — it carries a real year. Consequences: the deck shrinks by roughly a
  third on a real playlist, the card-1 gate is phrased as "the first card has a year" rather than "the
  resolved card was card 1", and all three entry points (`START`, `YEAR_RESOLVED`, `RESUME`) filter, so
  **no card in a live deck holds `year: null`**. `CardRevealSide`'s `none` branch is kept for
  pre-reversal saves only.
- **The preparing screen shows no resolved/total count.** Also a reversal; `PreparingScreen` takes no
  count props. `resolvedCount` stays exported beside the reducer, with its tests, and has no caller.
- **Exit goes through a confirmation dialog** (`ExitConfirmDialog`, opened by `GameScreen`). While it is
  open `GameScreen`'s window key handler is disabled — that is guard 4, and it exists because → would
  otherwise deal a card behind the backdrop.
- **The control bar's icons are inline SVG, not text glyphs**, sized from one token
  (`--size-control-icon`). ▶ and ❙❙ rendered at different weights and could resolve to an emoji font;
  nothing in CSS could equalise them. Exit is the emergency-exit pictogram in `--color-danger`.
- **`Card` accepts a `ref` and it is load-bearing**: `AnimatePresence mode="popLayout"` reaches the
  outgoing card through it, and silently does nothing without it — the incoming card was being laid out
  a full card-height below the outgoing one. See `docs/agent_findings.md`.

**The real-device pass was RUN on 2026-08-06, on Android, and it found exactly one defect: audio kept playing while the phone was locked.** `useCardAudio` now pauses on `visibilitychange` when `document.hidden` — which also covers switching apps and tabs. **Pause, not stop** (the position survives), and **no auto-resume** when the page becomes visible again. It lives in the hook rather than in `GameScreen` because it is a property of the DOCUMENT rather than of the card: no card changed. The leak rule was never breached — `navigator.mediaSession.metadata` has never been set, so the media panel could not name the track — but playing at all was wrong. Gestures, the flip-surviving audio and the on-screen QR scan all passed; **the five gesture constants were not retuned**, so they are now validated on one device rather than guesses. Writing the test for the fix exposed that `useCardAudio.test.ts` had **no `afterEach(cleanup)`**: a document-level listener is the first thing in a file capable of revealing that, and every earlier test acted only on its own element. Full results in [`docs/agent_findings.md`](./docs/agent_findings.md) and [`docs/development.md`](./docs/development.md) §5.

**Manual verification outstanding, and no local check will ever close it:**

- Phase 4: the QR scan was verified on a real phone (2026-08-05, re-confirmed 2026-08-06). The **devtools DOM search on an unflipped card** is still owed.
- Phase 5: **the iOS half of the touch pass has still never been run** — the 2026-08-06 pass was Android only, so tap-versus-swipe under Safari, pull-to-refresh suppression, whether the card needs `select-none`, and whether audio starts from the first tap are all open. Checklist in [`docs/development.md`](./docs/development.md) §5.
- The **lock-screen fix needs one re-check** on the phone: play, lock, confirm silence, unlock, confirm Play continues rather than restarting.
- Phase 6: **progressive loading against a real preview deployment with Upstash configured** (step 15 of [`plan.phase-4-6-screens.md`](./docs/plans/plan.phase-4-6-screens.md), carried over from Phase 3) is not done. Nothing local models it: the shared cache and the 1 req/s gate are both backed by the Upstash variables, and without them the gate paces nothing. It also owes the **50-track cold-deck wall clock**, unmeasured since Phase 2, and a **count of `/api/year` requests under React 19 StrictMode** — `use-game-session.ts` has a double-crawl guard that nothing tests.
- The two browser checks the 2026-08-05 decisions owed — **one swipe** for `popLayout`'s measurement (jsdom computes no layout, so it bails there no matter what the code does) and **one QR scan at the larger 14/18 size** — were both closed by the 2026-08-06 Android pass. **The square card of 2026-08-11 does not reopen the scan**, and that is by construction: the ratio went to 7/12 only because its denominator changed, so the code is displayed at the same 224px / ~140px it was scanned at.
- The square card and the enlarged QR owe **five of the "three widths" rows** (2026-08-11): that the card is square at all three, that the control row's four gaps read as equal, **one scan on the 240px floor card** (the face is `overflow-hidden`, so a QR that does not fit is cropped rather than visibly overflowing, and a cropped code fails to scan while looking almost right — and the enlargement has its least margin exactly there), that the relocated scan caption is legibly dim under a card with a bloom around it, and that the footer does not push Start off a 320px landing screen.
- Phase 8: **nothing about the PDF export has been verified on paper.** The geometry, the pagination and the duplex mirror are unit-tested; the printer, the cut and a scan of a printed code are not. Six sharing/printing checks in [`docs/development.md`](./docs/development.md) §5.
- Phase 7 (first half): **all four behavioural passes are outstanding** — reduced motion with the OS preference set, three widths, keyboard-only, and a screen reader over one flip — plus the before/after screenshot comparison. The environment is the reason, not the effort: jsdom has no media queries, no `matchMedia`, no layout and no a11y tree, so class-name assertions are the ceiling. **Prioritise the screen reader.** Checklists in [`docs/development.md`](./docs/development.md) §5, gaps in its §8.

**The Phase 4/5 fixture harness is gone**, and so is `public/dev-preview.wav`, the generated audio file that stood in for the fixture cards' invented preview URLs. The fixture deck itself stays at `src/components/__fixtures__/cards.ts` — it is what every component test renders from. To look at one specific card shape, run a component test in watch mode; there is no longer a page that walks the deck.

---

## Key Rules

**Layout and imports** — details in [`docs/architecture.md`](./docs/architecture.md) §2

- `src/` = browser (may use the `@/` alias and DOM APIs) · `api/` = Node · `shared/` = both, so **no DOM and no Node APIs**.
- **`src/` has four subtrees, and which one a file belongs in is a real decision.** `src/game/` = the session (reducer, shuffle, resolver, persistence, gesture _decisions_, the playlist client, the error-copy map) — pure and framework-free apart from one hook. `src/components/` = presentational React, props in and callbacks out, no session knowledge. `src/hooks/` = the stateful concerns a component should not own (audio, gesture _binding_, the playlist request). `src/components/__fixtures__/` = the shared fixture deck every component test renders from. Logic that starts accumulating in a component belongs in a hook or in `src/game/`.
- **`src/App.tsx` is the ONLY caller of `useGameSession()`**, and the only file that knows all four statuses exist. Screens receive plain data and callbacks. `dispatch` is deliberately not exposed by the hook, so a screen cannot invent a transition the reducer's tests never considered — if a screen seems to need a fifth action, add it to the reducer with its tests.
- **Both HTTP clients live in `src/game/` and take an injected `fetch`** (`year-client.ts`, `playlist-client.ts`), with a thin hook over each. That is what keeps every status branch a **node-environment** unit test with no jsdom and no network. Anything that accumulates in the hook belongs in the client instead.
- **The decision/binding split is the house style, and it exists because of what cannot be tested.** Phase 3 did it for the resolver; Phase 5 did it for gestures. `src/game/gestures.ts` holds every threshold and comparison as pure functions over numbers; `src/hooks/useCardGestures.ts` only collects coordinates and dispatches. The reason is specific: **jsdom cannot exercise a drag** — Motion's drag reads element geometry jsdom does not compute, so a simulated pointer sequence tests the double, not the gesture. Thresholds left inline in the hook would be untested full stop. When adding gesture behaviour, the decision goes in `src/game/`, not the hook.
- **`api/` must import `shared/` by RELATIVE path, never via `@/`.** Vercel does not support tsconfig path mappings for functions — an aliased import type-checks locally and **fails at deploy time**. Grep for `@/` under `api/` before deploying. `api/hello.ts` is the minimal reference shape; `api/playlist.ts` is the reference for a real endpoint (method guard, query handling, typed-error-to-status mapping).
- **Every relative import that can end up inside a function bundle needs an explicit `.js` extension** — `'../shared/constants.js'`, not `'../shared/constants'`. That covers all of `api/` and any `shared/`→`shared/` **runtime** import (type-only imports erase, so they are exempt). `"type": "module"` makes the deployed function ESM, and Node's ESM resolver does not guess extensions; Vercel transpiles rather than bundles, so the specifier reaches Node verbatim. Getting this wrong yields `FUNCTION_INVOCATION_FAILED` at runtime after a build that logs **no error**, and **all five local checks pass either way** — measured on a real deploy 2026-08-04, see [`docs/agent_findings.md`](./docs/agent_findings.md). TypeScript and Vite both resolve the `.js` specifier back to the `.ts` source, so the same form works in the browser build and under Vitest.
- New files must land in the right tree, because that determines which typecheck config covers them.

**TypeScript** — details in [`docs/toolchain.md`](./docs/toolchain.md) §1–2

- **Two TypeScript installs exist on purpose.** `typescript` (6.0.3) is there _only_ so `typescript-eslint` can load; `typescript-7` (7.0.2) is the real compiler. Don't delete either, don't flip which one is aliased.
- **Never call bare `tsc`** in a script — the bin slot is contested. Invoke compilers by explicit path.
- **Root `tsconfig.json` must never become a solution file** (`files: []` + `references`). Vercel reads it to compile `api/`; a references-only root breaks the function build **at deploy time only**. No `references` and no `composite` anywhere. `build` must never become `tsc -b && vite build`.
- No `baseUrl` (removed in TS 7); `paths` targets must be relative.

**Conventions**

- **pnpm only.** Don't add `package-lock.json` or `yarn.lock`; keep `pnpm-lock.yaml` committed.
- **`engines.node` is `24.x` and deliberately does not match local Node.** Don't "fix" it. The `Unsupported engine` install warning is expected.
- **Prettier owns formatting.** No hand-formatting, no stylistic ESLint rules.
- **Tailwind v4 is CSS-first** — no `tailwind.config.js`. **The design surface is the `@theme static` block in `src/index.css`**, which is where a v3 reader would look for that config file: every colour, dimension, duration and interaction minimum in the app is named there. **A new component consumes tokens rather than inventing literals** — a colour written as `bg-neutral-900` instead of `bg-surface` is the thing to catch in review, because Phase 8 redesigns by changing token values and a stray literal is invisible to that. `focus-ring` and `touch-target` are `@utility` composites in the same file; every interactive element gets `focus-visible:focus-ring`.
- **An unknown Tailwind colour utility is a SILENT no-op, and all four checks pass either way.** `text-text-muted` against a theme defining `--color-fg-muted` emits **no rule at all** — no warning, no build error. It shipped once: the only text on the card's hidden face lost its colour and rendered near-black on a near-black card while typecheck, lint, test and build stayed green. When adding or renaming a token, grep the built CSS (`dist/assets/*.css`) for the utility, and prefer a class-name assertion in the component's test — `CardHiddenSide.test.tsx` has one.
- **`@theme static`, not bare `@theme`.** A plain `@theme` tree-shakes any token no generated utility references, which silently kills the ones consumed only through `h-(--card-height)`-style arbitrary values, through an `@utility`, or from inside the `prefers-reduced-motion` block.
- Vitest config lives in the `test` key of `vite.config.ts`. **The default environment is `node` and stays that way** — it is what makes a DOM API accidentally added to `shared/` (which must stay portable to `api/`) fail a test run. A test needing a DOM opts in **per file** with a `/** @vitest-environment jsdom */` docblock as the first thing in the file. Do not globalise jsdom.
- **Testing Library does not clean up between tests here.** Its auto-`afterEach(cleanup)` only registers when Vitest `globals` are on, and this repo imports `describe`/`it`/`expect` explicitly — so every DOM test file needs its own `afterEach(cleanup)`. Without it, a test queries a DOM still holding every previous render, and the failure reads as a component bug.
- **The hidden side of a card must leak nothing, and the audit covers more than visible text.** Attributes, `aria-label`s, `alt` text, live regions, and the OS media session are all leak surfaces. Never set `navigator.mediaSession.metadata`. See [`docs/architecture.md`](./docs/architecture.md) §3.
- **`CardRevealSide`'s live region is the ONE place announcing track data is correct, and it is not a bug.** Phase 7 gave the reveal a polite `role="status"` because the flip was otherwise silent to assistive technology — the year, the payoff of the whole game, was reachable by sight only. It is safe because `Card.tsx` mounts that component **only while the card is flipped**, so the region cannot exist on a card that is still a mystery. **Do not add one to `CardHiddenSide`, to `CardStack`'s backs, or to the HUD** beyond the `role="status"` already on the count; `CardHiddenSide.test.tsx` asserts the absence. If you are about to file the reveal's region as a leak, you are reasoning from the rule without its mounting condition.
- **Never put secrets in `api/` source** — the Vite dev server serves it as readable text.

**No Spotify credentials exist or are needed.** Spotify's Feb 2026 API changes mean no credentialed path can serve "anyone with a public link", so the app reads the public embed endpoint anonymously. Before adding a `SPOTIFY_CLIENT_ID`, read [`docs/plans/plan.md`](./docs/plans/plan.md) §2 — **it is a product decision, not an oversight.**

**The embed payload has NO "added by" field, and that has now been spiked twice — do not spike it a third time.** Phase 0 enumerated the track-level field union; the re-spike on 2026-08-06 did it again against one editorial and one user-owned playlist, both identity-confirmed by `entity.uri` **and** `entity.name`, and found the same 15 fields with no attribution field of any shape (`authors` at playlist level is `null`). `plan.md` §5's Phase 8 item is therefore **resolved as won't-build**, and its one re-open condition is §2's no-credentials decision above, not the payload — `added_by` exists only on the Web API's `items`, which neither Client Credentials nor an anonymous caller can read. If you need to check anyway, the five-step re-run procedure is in [`docs/agent_findings.md`](./docs/agent_findings.md) (2026-08-06); **do not add an optional `addedBy` to `Card` "for later"**, and do not build a UI against the absent field.

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
