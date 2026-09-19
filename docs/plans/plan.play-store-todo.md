<!-- Plans for google-play (in order):
  1. plan.google-play-shell.md       — packaging the PWA as a Trusted Web Activity. STEPS 1-5 BUILT 2026-09-19; the rest is FROZEN and tracked in plan 3
  2. plan.google-play-back-button.md — Android's back gesture as an in-app control. CODE BUILT 2026-08-12; its seven device rows are tracked in plan 3
  3. plan.play-store-todo.md         — everything still between the committed repo work and a staged production rollout  ← this file. THE ONLY EXECUTABLE ONE
-->

# Plan: play-store-todo — From the committed repo work to a staged Play rollout

> **Task:** `play-store-todo` (continues `google-play`)
> **Date:** 2026-09-19
> **Author:** Aleix Rabassa
> **Depends on:** [plan.google-play-shell.md](plan.google-play-shell.md) — its steps 1–5 are the inputs here (pinned origin, manifest fields, `public/privacy.html`, the placeholder `public/.well-known/assetlinks.json`, the installed toolchain); and [plan.google-play-back-button.md](plan.google-play-back-button.md) — its code is built and only its device rows remain, which run here.

---

## Overview

Plans 1 and 2 left the Google Play release in a state no single file described: plan 1's steps 6–18
open, three deploy-dependent sub-items inside its finished steps, two unit tests deferred to its step
12, plan 2's seven device rows waiting on an install that did not exist, and a handful of decisions —
the `'Hitster'` label on the first suggested playlist, the custom-domain question — parked as open
questions in one file and out-of-scope bullets in the other. This plan collects **all of it** into one
ordered list that ends at a staged production rollout, and **freezes the two old plans**: they keep
their history and their reasoning, but every unfinished box in them now points here, so no step can
be executed from two places.

Three things the old plans did not contain and this one does: a **day-0 step** that starts the two
long waits (Play Console identity verification; obtaining an Android device) before any shell work,
because nothing until old step 11 needs the account and a naive transcription of the old order would
serialise a multi-day verification behind a week of typing; **the relabel** of
`SUGGESTED_PLAYLISTS[0]` to `'Jitster official'`, decided 2026-09-19, which is what unblocks every
screenshot of the picker; and **an actor tag on every step**, because three different hands do this
work and `/plan-exec` can only be one of them.

**What was already measured on 2026-09-19, after commit `8801190` was pushed and Vercel deployed
it** — so step 2 below is a recording, not an errand: `https://playlistjitster.vercel.app/.well-known/assetlinks.json`
answers `200`, `application/json; charset=utf-8`, 223 bytes, the real statement list and not
`index.html`; `/privacy.html` answers `200`, `text/html`; and Google's checker at
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://playlistjitster.vercel.app&relation=delegate_permission/common.handle_all_urls`
fetches the file and reports `ERROR_CODE_MALFORMED_CONTENT — must contain at least one certificate: []`.
That verdict is **correct for the placeholder** and is worth more than a 200: it proves the verifier's
own fetch path end to end (right host, no rewrite, right content type) while telling us that an empty
list reads as _malformed_, not as "reachable with zero certificates". Its response also carries
`maxAge: 600s`, so a redeploy loop at step 11 waits ten minutes between attempts.

---

## How to read and execute this plan

**This is the only file `/plan-exec` should ever be pointed at for Google Play.** Plans 1 and 2 are
frozen: their remaining `[ ]` boxes carry a note naming the step here that owns them, and they are
ticked only when this plan's matching step ticks — never independently.

**Every step carries one of three actor tags**, and the tag is the instruction:

- **`[agent]`** — runnable from this repo with no device, no Console and no prompt. `/plan-exec`
  implements these, ticks them, and runs the four checks.
- **`[you type it]`** — interactive, or needs the phone. `bubblewrap init` and `bubblewrap build`
  prompt for the application id, the colours, the orientation and — on every build — the keystore
  passwords; a non-interactive shell hangs or answers with defaults, and a default is wrong in the one
  place that is permanent. `/plan-exec` **prepares** these (the exact command, the prompt answers,
  what a pass looks like), then stops and waits for the developer to run them via `!` in the prompt
  and report back. It never simulates a device row.
- **`[Console]`** — Play Console, browser only. Same rule: prepared, then handed over.

**Keystore passwords never appear in a shell command, in this plan, in a findings entry or in a
chat.** They live in a password manager. A `[you type it]` step that needs one says so and nothing
more.

**Runnable today, before any device or account exists:** steps 2, 3 and 8 in full, and the `[agent]`
halves of steps 1 and 4. Step 1's two waits should be started **first**, on the same day, and the rest
of this list proceeds while they clear.

**Milestone gates** — named so "where are we" has a one-word answer: **M1** the relabel is live and
the three deferred fetch checks are closed (end of step 3); **M2** the verified install — no URL bar,
`pm get-app-links` says `verified`, all seven back-press rows passed on that build (end of step 12);
**M3** in closed testing with twelve testers opted in and the fourteen-day clock running (step 16);
**M4** staged production rollout live (step 17).

---

## Dependency Contract

### Requires from plan.google-play-shell

| Output                                                       | Description                                                                                                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The pinned origin `https://playlistjitster.vercel.app`       | Measured live; the old `custom-hitster.vercel.app` 307-redirects to it. Baked into the shell at step 4 and never changed after (decision 4 below closes the domain question). |
| `src/pwa/manifest.ts` with `id`, `lang`, `dir`, `categories` | What `bubblewrap init` reads over the network at step 4.                                                                                                                      |
| `public/privacy.html`, deployed                              | The listing's privacy-policy URL (step 14) and the enumeration the Data safety form is filled from.                                                                           |
| `public/.well-known/assetlinks.json`, deployed, empty list   | Filled with both fingerprints at step 11; its shape tests already exist in `src/pwa/assetlinks.test.ts`.                                                                      |
| The toolchain (`bubblewrap doctor` passing)                  | Bubblewrap 1.25.0, OpenJDK 17.0.10, build-tools 36.1.0, platform-tools 37.0.1 — versions and the two install traps in `docs/development.md` §9.                               |
| The application id `aleixrabassa.playlistjitster`            | Already in `assetlinks.json`; typed at the init prompt at step 4; cross-pinned by the step-11 test.                                                                           |

### Requires from plan.google-play-back-button

| Output                                                               | Description                                                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `useBackNavigation` mounted in `GameScreen`, in `main`               | The behaviour the seven device rows observe. No code changes here; if a row fails, that plan reopens. |
| The seven rows in `docs/development.md` §5, "The Android back press" | Run at step 7 (rows 1–6) and step 12 (all seven, row 7 mandatory).                                    |

### Produces for downstream plans

| Output                                     | Consumed by                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| A Play listing in staged production        | (no downstream)                                                                                       |
| Two recorded decisions on the back gesture | A possible future plan for end-screen / picker back interception — decided at step 12, not built here |

---

## Scope & Affected Areas

| Area                                                       | Type     | Notes                                                                                                                                                                               |
| ---------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/LandingScreen.tsx`                         | Modified | `SUGGESTED_PLAYLISTS[0].label` → `'Jitster official'`; one sentence of the array's header comment amended. **The id does not change.** The only application-code edit in this plan. |
| `src/components/LandingScreen.test.tsx`                    | Modified | One new trademark guard over labels and blurbs. Existing tests read the label symbolically (`SUGGESTED_PLAYLISTS[0]!.label`, eleven sites) and need no change.                      |
| `public/robots.txt`                                        | Modified | Line 1's "Custom Hitster is a single public page…" reworded; the file is publicly fetchable.                                                                                        |
| `docs/store/listing.md`                                    | Modified | §1's "blocked on one undecided trademark question" and "any screenshot of the picker is blocked" become history once step 3 deploys.                                                |
| `docs/store/tester-notes.md`                               | New      | The tester notes plan 1 said things "go in" and nothing ever produced.                                                                                                              |
| `android/`                                                 | New      | Generated by `bubblewrap init` at step 4. `twa-manifest.json` tracked; the generated Gradle project ignored (plan 1 decision 5, resolved 2026-09-19).                               |
| `.gitignore`                                               | Modified | At step 4: the `DELETE_PROJECT_FILE_LIST` entries, `*.aab`, `*.apk`, and the decision on Bubblewrap's manifest checksum file. Appended below the `.env` family, as before.          |
| `public/.well-known/assetlinks.json`                       | Modified | Both fingerprints at step 11, written by `bubblewrap fingerprint generateAssetLinks` and copied in — never hand-edited.                                                             |
| `src/pwa/twa-manifest.test.ts`                             | New      | Cross-pins `android/twa-manifest.json` against `manifest.ts` and the pinned origin. Written at step 4, when the file first exists.                                                  |
| `src/pwa/assetlinks.test.ts`                               | Modified | The two tests deferred from plan 1 step 4, written at step 11.                                                                                                                      |
| `docs/development.md`                                      | Modified | §9 corrected from the real release at step 18; §5 TWA and back-press rows move from Pending as they run; two caveats on the Google checker; row 4 gains "welcome".                  |
| `docs/agent_findings.md`                                   | Modified | Dated entries at steps 2, 3, 4, 6, 12 and 18 — listed under Documentation Updates.                                                                                                  |
| `docs/plans/plan.google-play-shell.md`, `…-back-button.md` | Modified | Frozen: index comment and per-step "tracked here" notes (done when this plan was written); their boxes tick only as this plan's steps tick.                                         |
| `docs/plans/plan.md`, `AGENTS.md`, `README.md`             | Modified | Status lines at M3 and M4; the Documentation Index row; the install line when a listing URL exists.                                                                                 |

**Not touched:** `src/game/`, `src/hooks/`, `api/`, `shared/`, the reducer, the persistence format,
the service worker's caching posture, `ExitConfirmDialog`. The store build is the deployed site.

---

## Chosen Approach

**One linear plan on the calendar critical path, with actor tags on every step and four named
milestone gates** — chosen over a two-file split at the Console boundary and over a three-track
layout with explicit joins. The split was rejected by its own analysis: it produces four Google Play
plan files, the pass/fail gate (old step 12) straddles the seam, and the only parallelism it buys a
single developer is "start the Console account early", which a linear plan achieves with one step
placed first. The three-track layout maps well onto how `/plan-exec` batches and makes the two long
waits explicit, but no plan in this repo uses tracks, `/plan-exec` has no notion of a step the
developer must type, and top-to-bottom ticking is lost. The linear plan keeps the repo's idiom and
borrows the two things the tracks did better: the waits are the first step, and every step says whose
hands it needs.

---

## Implementation Steps

- [ ] **Step 1 `[Console]` `[you type it]` — Day 0: start both long waits before anything else.**
      Nothing until step 10 needs the account and nothing until step 7 needs the phone, but both take
      calendar time that no later step can shorten.
  - [ ] `[Console]` Register the personal Play developer account, pay the one-time 25 USD fee, and
        **start identity verification** (absorbs plan 1 step 10, first half). It can take days;
        creating the app itself is step 9 and waits on it. Record the date started.
  - [ ] `[you type it]` **Obtain an Android device** — no step in either old plan does this. Plan 1
        step 9 says "a real device"; `docs/store/listing.md` §4 allows an emulator for screenshots
        only. Decide which rows an emulator may satisfy and write the decision down: an emulator is
        fine for launch, deal, flip, both PDF downloads and the App Link; it is **doubtful** for the
        lock-screen audio row and for Android 13+ predictive back, and predictive back is the one row
        whose remedy lives in `android/`, so the closed-testing AAB should not be final on an
        emulator-only verdict. Android 13 or newer is required for row 7 either way.
  - [ ] `[agent]` Record the two start dates and the device decision in `docs/agent_findings.md`.

- [ ] **Step 2 `[agent]` — Close plan 1's three deploy-dependent sub-items from the measurements
      above.** They were unticked because there was no deploy in the session that built them; commit
      `8801190` was pushed afterwards and Vercel deployed it, and the Overview records what the origin
      now answers. Re-run the three fetches (`curl -sI` on both files, plus the Google checker URL)
      rather than trusting the Overview, then:
  - [ ] Tick plan 1 step 3's "Verify after deploy" sub-bullet, step 4's "Deploy, then fetch" and
        "Record all three findings" sub-bullets, and step 4's parent.
  - [ ] Append the **third finding** to `docs/agent_findings.md` (the 2026-09-19 asset-links entry
        says it is missing): the production fetch results, the checker's `MALFORMED_CONTENT` verdict
        as the expected reading of an empty list, and its 600 s cache.
  - [ ] Tick plan 1's `docs/agent_findings.md` Documentation Update **only if** its other ask — the
        Play target-SDK minimum on the day it was checked — is also recorded, which is step 6 here;
        otherwise leave it for step 6.

- [ ] **Step 3 `[agent]` — The trademark pass, ending in a deploy. Gate M1.** Decided 2026-09-19:
      relabel, do not replace. This is the step that unblocks picker screenshots; do it before the
      shell so the first install already shows the new label.
  - [ ] Re-verify the id first, because `LandingScreen.tsx`'s rule 1 says to verify before shipping
        **any** change to that array, by `entity.uri` **and** `entity.name` in the embed payload and
        never by a 200. Done once on 2026-09-19 — `spotify:playlist:34cIJlWIX9TEoA8bpI2UBu`, entity
        name **"Hitser"** (sic, one _t_) — so the app's label is the one place that _introduces_ the
        mark; repeat the check on the day and record both values.
  - [ ] Read the playlist's **owner** out of the same payload, because rule 2 says a personal playlist
        is a weaker promise than an editorial one and a label reading "official" makes a promise of its
        own. Record who owns it; if it is not the developer's, reconsider the word "official" with the
        developer before shipping.
  - [ ] Change `SUGGESTED_PLAYLISTS[0].label` from `'Hitster'` to **`'Jitster official'`**. Leave the
        id and the blurb.
  - [ ] Amend the array's header comment: the paragraph saying labels are "readable renderings of
        Spotify's own titles" and the block's "labelled by genre and era" need one sentence admitting
        that the first row is labelled for the app rather than for its Spotify title, and why (the
        listing's trademark rule, dated). Keep the leak reasoning — the label still names no track and
        no year.
  - [ ] Reword `public/robots.txt` line 1 so it no longer opens "Custom Hitster is…" — the file is
        served at `<origin>/robots.txt`. "Playlist Jitster" is the value; nothing else in the file
        changes.
  - [ ] Rewrite `docs/store/listing.md` §1: the "blocked on one undecided trademark question" status
        (line 11), the "one unresolved hit — the listing is blocked on it" heading and body (from line
        40), and the "any screenshot showing the playlist picker is blocked" consequence (line 62)
        become a dated record of the decision and the new label.
  - [ ] Tick plan 1's open question on the `'Hitster'` label and its custom-domain open question
        (decision 4 below), and annotate its Out-of-Scope bullet on relabelling as resolved here.
  - [ ] Add the trademark guard test (Unit Tests below), run `pnpm typecheck && pnpm lint && pnpm test
&& pnpm build`, commit, push. A push to `main` deploys (`docs/development.md` §7; the Vercel
        CLI is not installed here). Confirm the relabelled picker is live on the origin. Two commit-gate
        traps recorded on 2026-09-19: `App.test.tsx`'s end-reason test is flaky (re-run before
        concluding), and repo-wide `format:check` fails on CRLF artefacts (check Prettier per touched
        file).

- [ ] **Step 4 `[you type it]` then `[agent]` — Generate the shell.** Absorbs plan 1 step 6 in full.
  - [ ] `[you type it]` `mkdir android`, then `! cd android && bubblewrap init
--manifest=https://playlistjitster.vercel.app/manifest.webmanifest`. At the prompts: **type the
        application id `aleixrabassa.playlistjitster` over the proposed `app.vercel.playlistjitster`**;
        keep the manifest's name and short name, `standalone`, the page colour for theme and
        background, the 512 icon as the splash source; answer the orientation prompt with the
        **any/default** option (the manifest deliberately declares none and a test pins the absence);
        **decline** notification delegation, Play Billing and the geolocation permission; keep the
        default Custom Tabs fallback; leave shortcuts empty.
  - [ ] `[agent]` Confirm `android/twa-manifest.json` matches the deployed manifest field for field,
        then write the cross-pin tests (Unit Tests, batch A) so the confirmation survives the next
        `bubblewrap update`.
  - [ ] `[agent]` Extend `.gitignore`'s Android block, below the `.env` family as before: the
        `DELETE_PROJECT_FILE_LIST` paths that `bubblewrap update` regenerates (`android/app/`,
        `android/gradle/`, `android/settings.gradle`, `android/build.gradle`, `android/gradle.properties`,
        `android/gradlew`, `android/gradlew.bat`, `android/store_icon.png`), plus `*.aab` and `*.apk`.
        **Decide the manifest checksum file** that `updateProject` writes beside the manifest: read its
        name from the generated tree and whether `bubblewrap build` reads it; if `build` warns when it
        is absent, track it; otherwise ignore it. Record the decision.
  - [ ] `[agent]` Note in `docs/development.md` §9 what the shell opens on: `start_url` `/` is the
        welcome screen on every cold launch, by the 2026-09-18 decision.

- [ ] **Step 5 `[you type it]` — Generate and protect the signing key.** Absorbs plan 1 step 7.
  - [ ] Create the upload keystore where `bubblewrap init` asks, outside the repo or inside `android/`
        and ignored by the `*.keystore` / `*.jks` rules already in `.gitignore`. Passwords into the
        password manager; **never into a shell, this plan or a chat**. Back the file up.
  - [ ] Confirm `git status` shows no keystore before the next commit — the ignore rules were written
        before any keystore existed and have never been exercised.

- [ ] **Step 6 `[agent]` reads, `[you type it]` decides — Check the target SDK.** Absorbs plan 1
      step 8, with the 2026-09-19 finding that changes how it is done.
  - [ ] `[agent]` Read `targetSdkVersion` from what Bubblewrap 1.25.0 actually emitted, and read
        Play's current minimum for new apps from the Console's policy page **on the day** — the plan
        was written before the August 2026 advance.
  - [ ] If a bump is needed, express it in **`android/twa-manifest.json`**, never in
        `android/app/build.gradle`: that file is regenerated from the manifest on every `bubblewrap
update`, so a hand edit is silently discarded and the symptom is a Play upload rejected
        months later. Then run `bubblewrap update` to regenerate.
  - [ ] `[agent]` Record the value, the requirement and the date in `docs/agent_findings.md`, and
        tick plan 1's `docs/agent_findings.md` Documentation Update if step 2 left it.

- [ ] **Step 7 `[you type it]` — First build, first install, URL bar expected. Gate M2a.** Absorbs
      plan 1 step 9 and plan 2 step 5's rows 1–6.
  - [ ] `! cd android && bubblewrap build`. Record where the AAB and the APK land (nothing in the repo
        says), and confirm both are ignored.
  - [ ] Install the APK. **A URL bar across the top is the correct state** — asset links are not
        verified yet, and seeing it now is what makes its disappearance at step 12 evidence.
  - [ ] Run `docs/development.md` §5 "The Trusted Web Activity shell" rows 2, 4, 5 and 6 (both PDF
        downloads — the static one only on the **second** launch once `sw.js` controls the page;
        storage shared with Chrome in both directions; the lock-screen audio re-check; launch on the
        welcome screen, deal, play, flip). Row 1's first half (the URL bar is present) is observed
        here.
  - [ ] Run plan 2's rows 1–6 ("The Android back press"); **attempt row 7** (predictive back) too. A
        row that fails here and passes at step 12 is itself a finding.
  - [ ] Mark each row's Status in `docs/development.md` and record anything that failed. `adb` is not
        on the PATH: `C:\Android\sdk\platform-tools\adb.exe`.

- [ ] **Step 8 `[agent]` — Write the tester notes.** Plan 1 step 9 and its decision 19 say the
      shared-storage behaviour "goes in the tester notes"; nothing ever produced them. Create
      `docs/store/tester-notes.md` with: how to opt in to the closed track; that the app shares its
      saved game and saved playlists with Chrome on the same phone, so "it remembered a game I never
      played in it" is expected; that the welcome screen shows on every cold launch, by decision; that
      the URL bar should be absent (report it if seen); what to report and where. Plain language — it
      is read by twelve people who did not build the app.

- [ ] **Step 9 `[Console]` — Create the Play Console app.** Absorbs plan 1 step 10, second half;
      waits on step 1's identity verification. Name "Playlist Jitster", default language English,
      Games category with a music/trivia subcategory, free, not primarily child-directed.

- [ ] **Step 10 `[Console]` — Upload to internal testing and read BOTH fingerprints.** Absorbs plan 1
      step 11. Upload the step-7 AAB to the internal track; on the app-signing page copy **two**
      SHA-256 fingerprints — the app signing key (Google's) and the upload key (yours). One of the two
      is the classic mistake, and it presents as a URL bar on exactly half the installs.

- [ ] **Step 11 `[you type it]` then `[agent]` — Complete the asset links and redeploy.** Absorbs the
      first half of plan 1 step 12.
  - [ ] `[you type it]` `bubblewrap fingerprint add <sha256>` for each of the two, then `bubblewrap
fingerprint generateAssetLinks`, so `twa-manifest.json` is the record of which fingerprints a
        release carried.
  - [ ] `[agent]` Copy the generated statement into `public/.well-known/assetlinks.json` — never
        hand-edit two files — then write the two tests deferred from plan 1 step 4 (Unit Tests, batch
        B), run the four checks, commit, push.
  - [ ] `[agent]` After the deploy, wait at least **600 seconds** (the checker's cache), then fetch
        the Google checker URL from the Overview and confirm the statement list parses with two
        certificates. `adb shell pm verify-app-links --re-verify aleixrabassa.playlistjitster` forces
        the device's own fresh attempt.

- [ ] **Step 12 `[you type it]` — Prove verification. Gate M2, and the AAB is final after it.**
      Absorbs the second half of plan 1 step 12 and all of plan 2 step 5.
  - [ ] Reinstall. **No URL bar.** If one appears, the fingerprints or the package id disagree with the
        build — stop here until it is gone.
  - [ ] `adb shell pm get-app-links aleixrabassa.playlistjitster` must list `playlistjitster.vercel.app`
        as `verified` — the instrument, not the missing bar (§5 TWA row 7).
  - [ ] Open a shared deck link, `<origin>/?playlist=<ids>&seed=<hex>`, from another app; it must open
        the installed app **with the query string intact** and deal, not show the welcome screen (§5
        TWA row 3).
  - [ ] Re-run **all seven** back-press rows on this build, row 7 (predictive back) mandatory and on a
        physical Android 13+ device per step 1's decision. Re-run TWA row 1 (bar gone).
  - [ ] Decide the two questions plan 2 left for "after step 5", and record the decisions in that
        plan's Open Questions and in `docs/agent_findings.md`: whether back on the **end screen**
        should return to the picker, and whether back on the **picker** should go to the welcome screen
        as its on-screen Back button does. Deciding is in scope; building either is not.
  - [ ] Mark every row's Status in `docs/development.md`.

- [ ] **Step 13 `[you type it]` `[Console]` — Build the store listing.** Absorbs plan 1 step 13; the
      copy already exists in `docs/store/listing.md`.
  - [ ] Compose the 1024×500 feature graphic from `docs/assets/logo.png` (the master; never anything
        in `public/`), black floor raised to `#0a0a0a`. Open `public/pwa-512x512.png` by eye and check
        it against Play's icon spec — no check in this repo has ever opened an image.
  - [ ] Phone screenshots: the **welcome screen first** (a cold launch shows it), then the picker
        (unblocked since step 3), a dealt card, a revealed card.
  - [ ] Paste the short and full descriptions from `listing.md` §2–3 after re-running its character
        counts. Nothing pasted may contain the word the trademark rule forbids.

- [ ] **Step 14 `[Console]` — Policy declarations.** Absorbs plan 1 step 14. Data safety from
      `public/privacy.html`'s enumeration (title, artist **and duration** leave the device; the
      Upstash cache is server-side storage; Spotify receives the player's IP for preview audio only,
      and only after Play is pressed — not for the embed, which is fetched server-side); content
      rating including the user-generated-content question (the app renders arbitrary track titles
      from a player-chosen playlist); ads none; not child-directed; privacy policy URL
      `https://playlistjitster.vercel.app/privacy.html`.

- [ ] **Step 15 `[Console]` — Read the pre-launch report.** Absorbs plan 1 step 15. It is the first
      automated device coverage this project has had and overlaps the manual passes still Pending in
      `docs/development.md` §5. Fix anything real before production; record what it found.

- [ ] **Step 16 `[you type it]` `[Console]` — Closed testing. Gate M3, then a fourteen-day wait.**
      Absorbs plan 1 step 16. Create the closed track with the step-12 AAB; **recruit twelve or more
      testers** (a step plan 1 assumed and never wrote), send them `docs/store/tester-notes.md`, and
      keep them opted in for fourteen continuous days. Update `docs/plans/plan.md`'s status line.

- [ ] **Step 17 `[Console]` then `[agent]` — Production access and staged rollout. Gate M4.**
      Absorbs plan 1 step 17. Apply after the fourteen days; release to production as a **staged
      rollout**, never 100% on day one. Then `[agent]`: the `README.md` install line and store link
      (deferred on 2026-09-19 until a listing URL existed), and `plan.md`'s status line again.

- [ ] **Step 18 `[agent]` — Record the release process from what actually happened.** Absorbs plan 1
      step 18. `docs/development.md` §9 calls itself "a plan-derived skeleton" and asks to be
      corrected here: the real command sequence, the prompts as they were actually worded, where the
      AAB landed, how long identity verification and the checker took, and one note the old plan
      lacked — `public/privacy.html` **is precached** (it matches the `html` glob) and the worker
      waits for every tab to close, so a policy edit reaches installed devices late while a reviewer
      fetching the URL always sees the current bytes.

---

## Unit Tests

All node tests, no DOM, in this repo's default environment. **They land in three batches**, each
written the moment its input exists and never before — a test that is red for six steps is a test
people learn to skip (plan 1 decision 17).

**Batch 0 — with the relabel (step 3):**

- [ ] `should keep the registered mark out of every suggestion label and blurb` — covers
      `SUGGESTED_PLAYLISTS` in `src/components/LandingScreen.test.tsx`. A leak-proxy-shaped guard over
      DATA rather than an assertion about `COPY` wording, which is why it is allowed under the
      2026-08-12 copy rule: the array is third-party playlist data the rule never covered, and the
      listing's trademark rule is a hard constraint the store enforces, not a phrasing choice. Case-
      insensitive over `label` and `blurb` of every row.
- [ ] _(no new test for the relabel itself)_ — the existing landing-screen tests read
      `SUGGESTED_PLAYLISTS[0]!.label` symbolically at eleven sites and no test holds the literal, so
      the rename is invisible to the suite by design. Stated so nobody adds one.

**Batch A — after `bubblewrap init` (step 4), new `src/pwa/twa-manifest.test.ts`:**

- [ ] `should bind the shell to the pinned production host` — `host` in `android/twa-manifest.json`
      equals `playlistjitster.vercel.app`; a per-deployment URL or the old alias here is a URL bar with
      a green build.
- [ ] `should start at the root, like the web manifest` — `startUrl` is `/`, matching
      `manifest.start_url`.
- [ ] `should carry the same name, short name and colours as the web manifest` — `name`, `shortName`
      equal `manifest.name` / `manifest.short_name`; `themeColor` and `backgroundColor` equal
      `PAGE_COLOR`. The `PAGE_COLOR` / `--color-page` house shape, one level further out: three files
      now hold the page colour and none can derive it from another.
- [ ] `should not lock the orientation` — the prompt at step 4 is exactly the pressure that would;
      `manifest.test.ts` pins the web manifest's absence and cannot see this file.
- [ ] `should decline notification delegation` — `enableNotifications` is `false`; the privacy page
      promises it and the listing would otherwise show an unexplained permission.
- [ ] `should name the committed package id` — `packageId` equals `aleixrabassa.playlistjitster`, the
      same literal `assetlinks.test.ts` pins, so the two halves of the cross-pin exist even before the
      step-11 test joins them.

**Batch B — after both fingerprints exist (step 11), in `src/pwa/assetlinks.test.ts`:**

- [ ] `should list two colon-separated SHA-256 fingerprints` — count and format, deferred from plan 1
      step 4. One fingerprint is a valid file that produces a URL bar on half the installs.
- [ ] `should agree with android/twa-manifest.json about the package id` — the cross-file pin,
      deferred from plan 1 step 4; the file it needed did not exist until step 4 here.

**What none of these can prove:** that Android's verifier accepted the statement, that the URL bar is
gone, that the back gesture reaches the webview as `popstate`, or that the listing is compliant. Those
are steps 7, 12, 15 and 17 — a device and a Console.

---

## Documentation Updates

- [ ] `docs/plans/plan.google-play-shell.md` and `docs/plans/plan.google-play-back-button.md` —
      **done when this plan was written**: the three-plan index comment at the top of both, and a
      one-line "tracked in `plan.play-store-todo.md`" note under every unfinished step. Their boxes
      are ticked only by the step here that owns them (steps 2, 3, 6, 12).
- [ ] `AGENTS.md` — Documentation Index row for this plan naming it the only executable Google Play
      file; the google-play decision block's status sentence; the trademark relabel recorded beside
      the rename boundary (the `'Hitster'` label is gone from the picker; the storage keys and the
      package name are still never renamed).
- [ ] `docs/plans/plan.md` — the Post-Phase-8 Google Play entry says "Two plans"; it is three, with
      this one executable. Its status line is updated again at M3 and at M4.
- [ ] `docs/development.md` — §9 corrected from the real release (step 18); the Google checker's two
      caveats (an empty list is `MALFORMED_CONTENT`, not "reachable"; 600 s cache) beside the
      instrument it names in §5 and §9; back-press row 4 currently reads "landing, preparing or end"
      and must add **welcome**, the front door since 2026-09-18; every §5 TWA and back-press row moves
      off Pending as it is run.
- [ ] `docs/agent_findings.md` — dated entries for: the third asset-links finding (step 2); the
      entity name "Hitser" and the owner check (step 3); the checksum-file decision and the
      `DELETE_PROJECT_FILE_LIST` ignores (step 4); the target-SDK value and Play's minimum on the day
      (step 6); the two back-gesture decisions and any row that behaved differently between the
      URL-bar and verified builds (step 12); what the pre-launch report found (step 15).
- [ ] `docs/store/listing.md` — §1 rewritten after the relabel (step 3); the assets checklist ticked
      as the graphics and screenshots are made (step 13).
- [ ] `docs/store/tester-notes.md` — new, a deliverable in its own right (step 8).
- [ ] `README.md` — the install line and store link at M4 (step 17), where 2026-09-19 deferred them.
- [ ] `src/components/LandingScreen.tsx` — the header sentence about labels being renderings of
      Spotify titles, amended (step 3).
- [ ] `public/robots.txt` — line 1 (step 3).

---

## Testing Strategy

- **Unit tests:** the three batches above. Batch 0 guards the trademark rule over data; batch A
  converts step 4's "confirm field for field" and the orientation prompt into assertions that survive
  every `bubblewrap update`; batch B is the fingerprint count and the cross-pin that plan 1 deferred.
- **Integration tests:** none are possible — nothing in this repo can run Android's verifier, install
  an AAB or exercise a Play track. Recorded plainly rather than covered by a test that appears to.
- **Manual verification:** step 7 (URL-bar build: TWA rows 2, 4, 5, 6 and back-press rows 1–6), step
  12 (verified build: no URL bar, `pm get-app-links` verified, App Link with query string, all seven
  back-press rows with row 7 on Android 13+), step 13 (open the 512 by eye), step 15 (pre-launch
  report). The Google checker is the one device-free instrument and step 11 says how to read it.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                 | Rationale                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One linear plan with actor tags and milestone gates, over a two-file split or a three-track layout.                   | The split makes four Google Play files and its only real parallelism for one developer is "start the account early"; tracks have no precedent here and `/plan-exec` cannot execute a `[you type it]` step. The linear plan borrows both ideas that mattered: waits first, and a tag on every step. (2026-09-19)              |
| 2   | This plan runs to a **staged production rollout**, not to closed testing.                                             | Developer's choice on 2026-09-19. Stopping earlier would leave a fourth plan to write for two Console steps.                                                                                                                                                                                                                 |
| 3   | The old plans are **frozen**, with index comments and per-step notes, not deleted or rewritten.                       | They hold the reasoning and the dated history; what they must stop being is a second place to execute from. A note per unfinished step is the smallest edit that achieves that.                                                                                                                                              |
| 4   | **No custom domain.** The shell binds to `https://playlistjitster.vercel.app`.                                        | Developer's answer on 2026-09-19 to plan 1's open question. Cost recorded once: a future domain move is a new store release, because the origin is baked into the shell at step 4.                                                                                                                                           |
| 5   | `SUGGESTED_PLAYLISTS[0]` is **relabelled `'Jitster official'`**, id unchanged, rather than replaced.                  | Developer's choice on 2026-09-19. The file's own header calls labels renderings rather than quotations, which is what makes a relabel a permitted edit; the playlist's real Spotify title is "Hitser", so the old label was the only place the mark existed. The header sentence is amended so the rule and the array agree. |
| 6   | The Console account and the device are **step 1**, before any shell work.                                             | Nothing until step 10 needs the account and identity verification takes days; placing it where plan 1 had it (after the device rows) serialises that wait behind a week of typing. Same for the device: no old step obtains one.                                                                                             |
| 7   | Every step carries `[agent]`, `[you type it]` or `[Console]`, and `/plan-exec` implements only the first.             | Three different hands do this work. Without the tag, an executing agent would attempt `bubblewrap init` in a shell with no stdin and either hang or accept the wrong permanent application id.                                                                                                                               |
| 8   | Tests land in three batches tied to the step that creates their input.                                                | Plan 1 decision 17, extended: a `twa-manifest.json` test before step 4 and a fingerprint test before step 11 would each be red for several steps.                                                                                                                                                                            |
| 9   | The `twa-manifest.json` cross-pin tests exist at all.                                                                 | Step 4's "confirm the file matches field for field" is otherwise a one-time human check that `bubblewrap update` can silently undo; the orientation prompt is the one pressure `manifest.test.ts` cannot see. Same shape as `PAGE_COLOR` / `--color-page`.                                                                   |
| 10  | The tester notes are a committed file under `docs/store/`, not a message typed into the Console.                      | Plan 1 said two things "go in the tester notes" and nothing produced them. Twelve people read it; it should be reviewable and reused for the next track.                                                                                                                                                                     |
| 11  | The generated Gradle project is ignored; only `twa-manifest.json` is tracked; the checksum file is decided at step 4. | Plan 1 decision 5, resolved 2026-09-19 by reading the CLI: `bubblewrap update` deletes and regenerates the project. The checksum file's role was not read and is decided when it exists rather than guessed.                                                                                                                 |
| 12  | The target-SDK bump, if any, is expressed in `twa-manifest.json`.                                                     | `app/build.gradle` is in Bubblewrap's regenerated template list; a hand edit survives until the next `update` and then silently vanishes (2026-09-19 finding).                                                                                                                                                               |
| 13  | Deploys happen by pushing to `main`; the Vercel CLI is not installed and this plan does not install it.               | `docs/development.md` §7 records that pushes deploy; the 2026-09-19 measurements were made against a push-triggered deploy. Installing the CLI is a machine-setup change outside a release plan.                                                                                                                             |
| 14  | Row 7 (predictive back) must pass on a physical Android 13+ device before the closed-testing AAB is final.            | It is the one row whose remedy lives in `android/`, and an emulator's verdict on a system gesture animation is not evidence about a phone.                                                                                                                                                                                   |
| 15  | Deciding plan 2's two back-gesture questions is in scope at step 12; building either is not.                          | They were parked "until step 5 says how the gesture feels" and had no owner. A decision after the seven rows costs nothing; an implementation is a second `pushState` and a plan of its own.                                                                                                                                 |

---

## Open Questions

- [ ] **Can the upload key's fingerprint be read locally (`keytool -list -v`) and deployed alone, so
      the verified install (step 12) can be reached before the Console exists?** Technically the
      upload key is what verifies local installs. Against it: plan 1 decision 7 calls a one-fingerprint
      file "the classic mistake", the batch-B count test would pin it red, and the app-signing key is
      the one that verifies what testers install — so the benefit is a few days on the device path at
      the cost of a deliberately half-right deployed file. Recorded as a question, not a step; decide
      only if identity verification stalls.
- [ ] Which rows may an emulator satisfy, if no physical device is available at step 1? The doubtful
      two are the lock-screen audio row and predictive back (decision 14).
- [ ] What is the name and role of the checksum file `bubblewrap update` writes beside
      `twa-manifest.json` — read at step 4, not guessed.
- [ ] Who owns playlist `34cIJlWIX9TEoA8bpI2UBu`? If it is not the developer's, does "official" still
      hold? Read from the embed payload at step 3.
- [ ] Does the content-rating questionnaire's user-generated-content question apply to arbitrary
      track titles from a player-chosen playlist? (Carried from plan 1.)
- [ ] Must Vercel's access-log IP retention be declared in the Data safety form, or does it fall under
      the security-and-fraud exemption? (Carried from plan 1.)
- [ ] Does the listing name need more distance from the Hitster mark than "Playlist Jitster" already
      provides? (Carried from plan 1.)
- [ ] Where do the twelve testers come from, and by which distribution mechanism (email list or Google
      Group)? Decide before step 16 so the fourteen-day clock is not lost to opt-in churn.

---

## Out of Scope

- **Any application-code change beyond the relabel and the header sentence in `LandingScreen.tsx`.**
  The store build is the deployed site; if this plan starts editing `src/game/`, `src/hooks/` or `api/`,
  something has gone wrong.
- **Building back interception on the end screen or the picker.** Decided at step 12, built by a
  future plan if at all.
- **A persisted "seen the welcome screen" flag.** Cold launches show the front door by the 2026-09-18
  decision; if testers report it as friction, that is a product decision to reopen elsewhere.
- **A custom domain.** Decision 4.
- **iOS and the App Store.** Discarded by the developer; no Capacitor, no Mac.
- **CI-built releases and installing the Vercel CLI.** Local builds and push-to-deploy, until the
  cadence justifies secret handling in CI.
- **Push notifications, Play Billing, in-app updates, Play Integrity, app shortcuts.** Notification
  delegation is actively declined at step 4.
- **Renaming `hitster:session:v1`, `hitster:library:v1`, the `custom-hitster` package or any internal
  "Hitster" that means the board game.** The trademark rule applies to the listing and the picker's
  visible text; a renamed storage key silently discards every saved game.
- **Closing the outstanding manual passes in `docs/development.md` §5** beyond the rows this plan
  names and whatever the pre-launch report surfaces. The screen-reader pass is still owed and is not
  this plan's deliverable.
- **Any change to the service worker's caching posture.** `runtimeCaching` stays empty.
