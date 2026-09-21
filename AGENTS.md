# AGENTS.md

Instructions for Claude Code and other agents working in this repository. **[`docs/`](./docs/) is the source of truth** — read the relevant file before changing code or configuration.

Several decisions in this repo look like mistakes and are not. If something seems obviously wrong, check `docs/toolchain.md` before "fixing" it.

---

## Documentation Index

| File                                                                                         | What it covers                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/architecture.md`](./docs/architecture.md)                                             | Components, import boundaries between `src`/`api`/`shared`, data flow, external services, planned phases                                                                |
| [`docs/api.md`](./docs/api.md)                                                               | The `api/` surface, handler conventions, environment variable reference                                                                                                 |
| [`docs/toolchain.md`](./docs/toolchain.md)                                                   | The two TypeScript installs, the four tsconfigs, ESLint/Prettier, pnpm and the Node pin, Tailwind, Vitest                                                               |
| [`docs/development.md`](./docs/development.md)                                               | Setup, scripts, running functions locally, tests, deploy, known limitations                                                                                             |
| [`docs/agent_findings.md`](./docs/agent_findings.md)                                         | Running log of discoveries and gotchas found while working here                                                                                                         |
| [`docs/plans/plan.md`](./docs/plans/plan.md)                                                 | **Authoritative phase plan** — what belongs in which phase, plus all Phase 0 research findings                                                                          |
| [`docs/plans/plan.phase-1.md`](./docs/plans/plan.phase-1.md)                                 | Phase 1 detail, decisions, and execution notes                                                                                                                          |
| [`docs/plans/plan.phase-2-playlist.md`](./docs/plans/plan.phase-2-playlist.md)               | Phase 2, first half — URL parsing, the embed adapter, `/api/playlist`                                                                                                   |
| [`docs/plans/plan.phase-2-year.md`](./docs/plans/plan.phase-2-year.md)                       | Phase 2, second half — the cache, the MusicBrainz adapter, year resolution, `/api/year`                                                                                 |
| [`docs/plans/plan.phase-3.md`](./docs/plans/plan.phase-3.md)                                 | Phase 3 — the reducer, seeded shuffle, persistence, and the progressive-loading resolver                                                                                |
| [`docs/plans/plan.phase-4-6-card-ui.md`](./docs/plans/plan.phase-4-6-card-ui.md)             | Phase 4 — the DOM test environment, the flip card, the QR code, and card audio                                                                                          |
| [`docs/plans/plan.phase-4-6-gestures.md`](./docs/plans/plan.phase-4-6-gestures.md)           | Phase 5 — swipe, tap-versus-drag, the stacked deck, keyboard controls                                                                                                   |
| [`docs/plans/plan.phase-4-6-screens.md`](./docs/plans/plan.phase-4-6-screens.md)             | Phase 6 — landing, the playlist client, notices, the HUD, the end screen, the session container                                                                         |
| [`docs/plans/plan.phase-7-look.md`](./docs/plans/plan.phase-7-look.md)                       | Phase 7, first half — the `@theme` token layer, the fluid card, reduced motion, focus and ARIA                                                                          |
| [`docs/plans/plan.phase-7-robustness.md`](./docs/plans/plan.phase-7-robustness.md)           | Phase 7, second half — failure codes, the error boundary, the chunk splits, the meta tags, Lighthouse                                                                   |
| [`docs/plans/plan.phase-8-look-and-shell.md`](./docs/plans/plan.phase-8-look-and-shell.md)   | Phase 8, plan 1 — neon-ring card design, contrast re-audit, PWA, icon set. **Built**                                                                                    |
| [`docs/plans/plan.phase-8-features.md`](./docs/plans/plan.phase-8-features.md)               | Phase 8, plan 2 — the share link, the saved-playlist library, the PDF export, the audio reversal. **Built**                                                             |
| [`docs/plans/plan.phase-8-added-by.md`](./docs/plans/plan.phase-8-added-by.md)               | Phase 8, plan 3 — the "Added by" decision. Writes no code; resolved as won't-build                                                                                      |
| [`docs/plans/plan.multi-playlist-core.md`](./docs/plans/plan.multi-playlist-core.md)         | Multi-playlist, plan 1 — the merge module, the widened state, both v2 storage formats, the link. **Built**                                                              |
| [`docs/plans/plan.multi-playlist-ui.md`](./docs/plans/plan.multi-playlist-ui.md)             | Multi-playlist, plan 2 — the landing rows, the fan-out hook, the container wiring, the labels. **Built**                                                                |
| [`docs/plans/plan.year-accuracy.md`](./docs/plans/plan.year-accuracy.md)                     | The tier ladder — Singles/EPs in the top rung, the graded middle rung, the re-captured fixtures. **Built**                                                              |
| [`docs/plans/plan.suggestion-multi-select.md`](./docs/plans/plan.suggestion-multi-select.md) | Hold a suggested playlist to select it — the pure selection module, the press hook. **Built**                                                                           |
| [`docs/plans/plan.google-play-shell.md`](./docs/plans/plan.google-play-shell.md)             | Google Play, plan 1 — the Bubblewrap TWA shell, asset links, the listing, the store tracks. **Steps 1–5 built 2026-09-19**; `android/` and the store work outstanding   |
| [`docs/plans/plan.google-play-back-button.md`](./docs/plans/plan.google-play-back-button.md) | Google Play, plan 2 — Android back as an in-app control. **Built 2026-08-12**; device rows wait on plan 1. **Frozen 2026-09-19** — its rows run from plan 3             |
| [`docs/plans/plan.play-store-todo.md`](./docs/plans/plan.play-store-todo.md)                 | Google Play, plan 3 — **THE ONLY EXECUTABLE GOOGLE PLAY FILE.** Everything from the trademark relabel to a staged production rollout. Steps 2, 3 and 8 built 2026-09-19 |

**Do not build ahead of the current phase.** The plan defers things deliberately. Current phase: **8, CODE COMPLETE.** Phases 1–7 are complete, all three Phase 8 plans are resolved, and the app is playable end to end, has a design surface, is installable, and fails legibly. `src/App.tsx` is the **real container** and the only caller of `useGameSession()`. Plan 2 built the shareable deck URL, the saved-playlist library, the printable PDF export and the audio reversal; plan 1 built the neon ring, the contrast re-audit, the PWA and the icon set; plan 3 resolved "Added by" as won't-build with no code. Note that plan 2 depended on plan 1 only **softly** and did not wait — so the PDF's print palette is deliberately its own and did not change when the screen was redesigned. **Two developer requests landed on 2026-09-18 outside any plan**: a welcome screen in front of the picker (with a printable year-cards PDF), and a left swipe that steps BACK a card. Both blocks are below.

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
own header; the deletions are logged in [`docs/agent_findings.md`](./docs/agent_findings.md).

**THE FRONT DOOR IS A WELCOME SCREEN AS OF 2026-09-18, IT IS A CONTAINER FLAG AND NOT A FIFTH STATUS,
AND `LandingScreen` STILL MEANS THE PLAYLIST PICKER.** `src/components/WelcomeScreen.tsx` explains the
game — the hero is the logo, ONE tagline (`COPY.welcome.tagline`; the lead sentence it used to carry was
cut on 2026-09-18 as a restatement of the three steps) and one big button reading `COPY.welcome.enter`,
then three ordered "How it works" steps and the printable year cards; the button lands on
`LandingScreen`, which kept its name because forty-odd doc and test lines use it. **The picker has a
Back button** (`COPY.landing.backToWelcome`, a ghost `<button>` absolute in the top-left corner, out of flow, disabled while a
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
exit animation is DERIVED FROM THE INDEX DELTA as of 2026-09-19 (`exitDirectionFor` in `gestures.ts`,
latched in `CardStack` and handed to `AnimatePresence custom`, read by `CARD_VARIANTS.exit` in
`Card.tsx`) — so a thrown card still flies out the way it was thrown, and the KEYBOARD NOW MATCHES:
ArrowRight flies right, ArrowLeft flies left, where before every keyboard advance flew left because the
direction was hook state only a drag ever set. It goes through `custom` because an exiting child animates
with the props of its last render, and a keyboard advance changes the index and removes the card in the
same render. The gesture has been felt by **no thumb**: the manual rows are in
[`docs/development.md`](./docs/development.md) §5.

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
[`docs/architecture.md`](./docs/architecture.md) §3, "The combined deck".

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
([`docs/development.md`](./docs/development.md) §5).

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

**A shared link promises "same playlist, same shuffle", NEVER "the same deck", and the copy is the feature.** Yearless cards are dropped at play time and editorial playlists refresh their tracks, so the seeded shuffle is exact while its input is not. The rule now lives as a comment on `COPY.deckActions.shareCaption`; the test that asserted the phrase "same deck" was absent went with the 2026-08-12 copy centralisation, because it is the one kind of assertion `COPY` cannot express. Also load-bearing: a **saved session outranks a link** (opening an old one must not discard a game in progress), a malformed link is the plain **welcome** screen with **no error** (the front door since 2026-09-18 — with nothing to resume, `deckLink === null` is exactly what leaves the flag unseeded), and `App.tsx` **never touches the address bar** — no `pushState`, no `replaceState`. That rule is still true **of `App.tsx`** and is not the whole story any more: see the back-press block below, and do not delete the `pushState` in `useBackNavigation.ts` on the strength of this sentence. The link effect deliberately has **no "already submitted" ref**: such a guard survives StrictMode's simulated unmount, whose cleanup has already aborted the request it was recording, so the app would sit on the landing screen forever. That is measured and written up in [`docs/agent_findings.md`](./docs/agent_findings.md) (2026-08-06).

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

**THE STORE SHELL IS A FOURTH TOP-LEVEL TREE, AND AS OF 2026-09-19 THE TREE IS NOT THERE YET — grepping
for `android/` and finding nothing is the CORRECT reading of this repo, not a stale doc.**
[`docs/plans/plan.google-play-shell.md`](./docs/plans/plan.google-play-shell.md) packages the deployed
PWA as a Trusted Web Activity, and its steps 1–5 landed on 2026-09-19 while steps 6–18 did not.
**It is FROZEN as of 2026-09-19, along with the back-button plan, and
[`docs/plans/plan.play-store-todo.md`](./docs/plans/plan.play-store-todo.md) is the only file to
execute from** — the two old plans keep their reasoning and their history, and their unfinished boxes
tick only when the step that owns them in plan 3 ticks. Plan 3's steps 2, 3 and 8 are built: the
deployed asset-links and privacy fetches are recorded, the picker's first suggestion is relabelled
(below), and `docs/store/tester-notes.md` exists. **What
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
commit output. Their ignore entries land at step 6, when the files first exist; today `.gitignore`
names `android/build/`, `android/app/build/` and `android/.gradle/` **one at a time and never widens to
`android/`** — the widening is the edit that silently untracks the config. **The trap that follows
from the same reading:** `app/build.gradle` is regenerated too, so step 8's `targetSdkVersion` bump
must be expressed in `twa-manifest.json` — hand-edit it and the next `update` discards it, and the
symptom is a Play upload rejected months later. See `docs/agent_findings.md` (2026-09-19).

**`@bubblewrap/cli` is installed globally with `npm i -g`, and must NEVER enter `devDependencies`.** It is
an explicit, recorded exception to the pnpm-only rule rather than a violation of it: a project dependency
would pull an Android toolchain into `pnpm-lock.yaml` for a tool **not one of the four pre-commit checks
needs**; the install goes through `npm i -g`, so it never touches `pnpm-lock.yaml` at all. `pnpm add -D
@bubblewrap/cli` is the edit to refuse. The installed versions belong beside the release process in
[`docs/development.md`](./docs/development.md), because the next release runs against whatever the
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
`src/pwa/assetlinks.test.ts` — half a pin until step 12 adds the cross-file half against
`android/twa-manifest.json`, which is the only thing that can catch the two copies drifting apart.
**`id` resolves against the ORIGIN**, so the origin sits inside the app's identity: the last rule below is
the same fact seen from the other end — so moving to a custom domain later is a rebuilt shell and a new
asset-links deployment for the TWA, a SECOND install identity for every browser PWA install, and never a
redirect from the old origin: a TWA whose origin redirects has left the verified origin, which is a URL
bar.

**The TWA shares `localStorage` with the browser hosting it** — a Chrome TWA runs in Chrome's own
profile, so `hitster:session:v1` and `hitster:library:v1` on the origin are **one store seen from two
launchers**: a game started in the installed app resumes in the browser, and the reverse. **That is the
persistence design doing its job, not a defect**, and it is what makes the back-press block's "a relaunch
resumes" true at all. Namespacing the keys per launcher to "fix" it breaks that, and a renamed key is not
read — see the rename block. Unverified on a device; it is step 9.

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
[`docs/architecture.md`](./docs/architecture.md) §3; the device checks are rows in
[`docs/development.md`](./docs/development.md) §5, where **row 1 is half passed as of 2026-09-21** —
the bar was seen and then seen gone on one sideloaded build, either side of this deploy — and
**every other row is Pending**.

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
a reason. The test asserting the old label was absent went with the 2026-08-12 copy centralisation — the button's own `{ name: COPY.end.home }` query fails on any rename, which is the half that was worth keeping.

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

**There is a copyright footer, it is on ALL FIVE screens (four as of 2026-08-12, the welcome screen since
2026-09-18), and the one omission is the decision.** `src/components/Footer.tsx` renders on **welcome,
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
**THE BOUNDARY MOVED ONCE MORE, ON 2026-09-19, AND ONLY WHERE THE STORE FORCES IT:** the `'Hitster'`
label on `SUGGESTED_PLAYLISTS[0]` is gone from the picker, relabelled **`'Jitster official'` with the
id unchanged**, because a Google Play listing may not carry the registered mark and the picker is in
every screenshot of it (`docs/store/listing.md` §1). It cost nothing in faithfulness: the playlist's
real Spotify title is **"Hitser"**, one _t_, so the mark existed only in this app's own tidied
rendering of a typo — which is why `LandingScreen.tsx`'s "labels are readable renderings of Spotify's
own titles" paragraph now carries a sentence saying the first row is labelled for the APP instead, and
why `LandingScreen.test.tsx` guards every row's `label` and `blurb` against the mark case-insensitively
(a guard over DATA, not over `COPY.*` wording — the array was never copy). **Nothing in the
never-rename list above moved**: the two storage keys, the package name and every internal "Hitster"
that means the board game are untouched, and a store rule about visible text is not a reason to touch
one of them.

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

- 2026-09-18: **nothing about the welcome screen, the PDF download or the left swipe has been seen outside jsdom.** The two that matter: a click on the download in a tab the service worker controls must save the PDF and not reload the app (the `.pdf` denylist is unobservable under any dev server), and a left swipe on a phone must step back where a right swipe advances — the mapping is unit-tested, the thumb is not. Rows in [`docs/development.md`](./docs/development.md) §5.
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

- **pnpm only**, with exactly one recorded exception. Don't add `package-lock.json` or `yarn.lock`; keep `pnpm-lock.yaml` committed. The exception is `@bubblewrap/cli`, installed globally with `npm i -g` and never a project dependency — see the store-shell block above.
- **`engines.node` is `24.x` and deliberately does not match local Node.** Don't "fix" it. The `Unsupported engine` install warning is expected.
- **Prettier owns formatting.** No hand-formatting, no stylistic ESLint rules.
- **The copy surface is `src/game/copy.ts`, exactly as the design surface is the `@theme static` block.** A component renders `COPY.*` and a test asserts against `COPY.*`; a user-facing literal in either is the thing to catch in review, for the same reason a stray `bg-neutral-900` is — copy is reworded by changing one value, and a literal is invisible to that. Templated strings are functions so pluralisation cannot drift. `messages.ts` keeps the error map (its `Record<StartFailureCode, string>` exhaustiveness is the point); `index.html`, `src/pwa/manifest.ts` and `public/privacy.html` are outside the rule — none can import a runtime module — and copy `COPY.app.name` by hand.
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
