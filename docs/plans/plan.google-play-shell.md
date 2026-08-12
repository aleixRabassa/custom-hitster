<!-- Plans for google-play (in order):
  1. plan.google-play-shell.md       — packaging the PWA as a Trusted Web Activity and getting it through Play to production  ← this file
  2. plan.google-play-back-button.md — making Android's back gesture an in-app control instead of an app exit
-->

# Plan: google-play — Ship the app to Google Play (TWA shell and store release)

> **Task:** `google-play`
> **Date:** 2026-08-11
> **Author:** Aleix Rabassa
> **Depends on:** nothing. This is plan 1 of 2 and is independently shippable.

---

## Overview

Publish the existing deployed PWA to the Google Play Store as a **Trusted Web Activity** — a
native Android shell that renders the live site full-screen with no browser chrome, verified by
Digital Asset Links. The app itself does not change: the store build is the same deployment the
browser already loads, so a Vercel redeploy updates every install with no new release.

The work splits into three unequal parts. The **repo-side work is small and mostly
verification** — completing a few manifest fields, publishing a privacy policy, serving one JSON
file at a well-known path, and pinning both against tests. The **packaging work** is a
Bubblewrap-generated Gradle project committed alongside the app. The **store work is the bulk of
the calendar time**, and on a personal developer account it is gated behind a closed test with
twelve testers opted in for fourteen continuous days before production access is granted at all.

Nothing here is technically difficult. Almost everything here is silently failable — a wrong
certificate fingerprint produces an app that launches with a Chrome URL bar across the top and no
error message anywhere, which is the single failure mode this plan is shaped to prevent.

---

## Dependency Contract

### Produces for downstream plans

| Output                                | Consumed by                    | Description                                                                                                                                                                 |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An installed, asset-link-verified TWA | `plan.google-play-back-button` | The back-button behaviour cannot be observed in a browser, because a browser has its own back affordance and its own history. Verification requires this build on a device. |
| The permanent application id          | `plan.google-play-back-button` | Only for the device-install instructions in that plan's manual checks.                                                                                                      |
| The closed-testing track              | `plan.google-play-back-button` | Recommended landing window — see the sequencing note below.                                                                                                                 |

**Sequencing note.** Plan 2 is not a blocker for reaching closed testing, and it should not be
treated as one. The intended order is: this plan reaches closed testing, plan 2 lands _inside_ the
fourteen-day window while testers are already exercising the build, and the production rollout
carries both. That way the fourteen days are spent, not waited out twice.

---

## Scope & Affected Areas

| Area                                 | Type            | Notes                                                                                                                                     |
| ------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `android/`                           | New             | Bubblewrap-generated Gradle project. A fourth top-level tree, subject to none of the `src`/`api`/`shared` import rules.                   |
| `android/twa-manifest.json`          | New (committed) | The packaging config, and the one file in `android/` that must be tracked — it is what makes a release reproducible.                      |
| `public/.well-known/assetlinks.json` | New             | Digital Asset Links. Carries **two** certificate fingerprints, not one.                                                                   |
| `public/privacy.html`                | New             | Mandatory for the listing. A static file because the app has no router; its dotted path bypasses the SPA rewrite in `vercel.json`.        |
| `src/pwa/manifest.ts`                | Modified        | Add `id`, `lang`, `dir`, `categories`. Deliberately do **not** add `orientation`.                                                         |
| `src/pwa/manifest.test.ts`           | Modified        | Assert the added fields, and pin the absence of `orientation`.                                                                            |
| `src/pwa/assetlinks.test.ts`         | New             | Node test reading the static file from disk and cross-pinning the package id against `twa-manifest.json`.                                 |
| `.gitignore`                         | Modified        | Keystore and Gradle build output. Appended without introducing any new `.env*` pattern — see the negation-last rule already in that file. |
| `docs/store/`                        | New             | Listing copy and graphics, so the store listing is reviewable and reproducible rather than living only in the Console.                    |
| `vite.config.ts`                     | Verify only     | Confirm `globPatterns` does not precache the JSON and that `globIgnores` needs no change. No edit expected.                               |
| `AGENTS.md`                          | Modified        | Two Documentation Index rows, plus the new rules this tree introduces.                                                                    |
| `README.md`, `docs/*`                | Modified        | See Documentation Updates.                                                                                                                |

**Not touched:** every file under `src/components/`, `src/game/`, `src/hooks/`, `api/` and
`shared/`. If this plan starts editing application code, something has gone wrong — the store build
is the deployed site.

---

## Chosen Approach

**Bubblewrap CLI, with `android/twa-manifest.json` committed to this repo and the AAB built
locally on Windows.** Bubblewrap is the official TWA toolchain: it reads the deployed
`manifest.webmanifest` over the network, generates a Gradle project, and emits a signed AAB plus a
starter `assetlinks.json`. The web deployment stays the single source of truth for what the app
does, so the store release adds a distribution channel without forking behaviour.

Chosen over **PWABuilder** because that tool's packaging step lives outside version control: each
release would be a manual re-run of a website, `twa-manifest.json` tuning would be limited to what
the form exposes, and the "committed to this repo" requirement could not be met. Chosen over
**Capacitor for Android** because Capacitor bundles `dist/` into the app, which breaks the property
that a redeploy updates every install, and because it would force CORS headers onto
`api/playlist.ts` and `api/year.ts` (neither sets any today) — real work, for nothing the store
asks for. Local builds over CI because the release cadence is one app with no team; the GitHub
Actions migration is recorded in Out of Scope rather than built speculatively.

---

## Implementation Steps

- [ ] **Step 1 — Pin the origin.** Everything downstream is bound to one origin permanently, so
      establish it before generating anything.
  - [ ] Identify the **stable production alias** on Vercel, not a per-deployment URL. Deployment
        URLs change on every push; an alias does not, and a TWA bound to a deployment URL breaks on
        the next deploy.
  - [ ] Confirm `manifest.webmanifest` is served at that origin's root, and that `index.html` in the
        built output carries the injected `<link rel="manifest">` and the worker registration
        script. Neither is written by hand — `vite-plugin-pwa` injects both — so confirm rather than
        assume.
  - [ ] Record the origin in `docs/development.md` as the one value later steps read.

- [ ] **Step 2 — Complete the manifest.** In `src/pwa/manifest.ts`, add the fields Bubblewrap and
      Play read and that are currently absent.
  - [ ] Add `id` set to the same value as `start_url`. This is explicit-not-new: the spec already
        defaults `id` to `start_url`, so writing it changes nothing today and prevents a future
        `start_url` edit from silently minting a **second app** on the store.
  - [ ] Add `lang` and `dir`, which Bubblewrap prompts for and Play uses for the default listing
        language.
  - [ ] Add `categories` naming games and music.
  - [ ] **Do not add `orientation`.** Its absence is a decision recorded in that file's doc comment
        (the `--card-height` clamp exists precisely so a short wide viewport gets a smaller card),
        and Bubblewrap will prompt for it — answer with the any/default option so the generated
        project does not lock rotation. Extend the doc comment to say the absence is now pinned by a
        test, and why the prompt is the thing that threatens it.
  - [ ] Do not touch `name`, `short_name`, `start_url`, `display`, the colours or the icons.

- [ ] **Step 3 — Write the privacy policy.** Create `public/privacy.html` as a self-contained
      static page. It must accurately describe, at minimum: the two `localStorage` keys and that
      they never leave the device; that a playlist id is sent to this app's own function to read the
      public Spotify embed; that a track title and artist are sent to the year function and cached
      server-side in Upstash with a TTL; that preview audio and the embed are fetched by the browser
      directly from Spotify, so Spotify receives the player's IP address; that MusicBrainz is
      contacted server-side and therefore does not see the player; and that there are no accounts,
      no ads, no analytics and no third-party SDKs. Include a contact address.
  - [ ] Verify after deploy that the page is served rather than swallowed by the SPA rewrite. The
        rewrite source pattern in `vercel.json` excludes paths containing a dot, so a `.html` path
        should pass through — confirm it, because a listing pointing at a 404 is a review rejection.

- [ ] **Step 4 — Serve a placeholder `assetlinks.json` and verify the path end to end.** Do this
      **before** any keystore exists, because it isolates the two things that can go wrong.
  - [ ] Create `public/.well-known/assetlinks.json` with the correct statement-list shape — a single
        statement delegating `common.handle_all_urls`, targeting the `android_app` namespace, naming
        the application id, with an empty fingerprint list for now.
  - [ ] Confirm `vite build` copies the **dot-directory** out of `public/` into `dist/`. This is the
        step most likely to surprise; verify it against the build output rather than trusting it.
  - [ ] Deploy, then fetch the file from the production origin and confirm it returns the JSON with a
        JSON content type and is **not** rewritten to `index.html`.
  - [ ] Confirm the file is absent from the generated precache manifest — `globPatterns` in
        `vite.config.ts` does not list `json`, so it should be. Asset-link verification is performed
        by the Android system rather than by the webview, so a cached copy would be wrong as well as
        useless.
  - [ ] Record all three findings, dated, in `docs/agent_findings.md`.

- [ ] **Step 5 — Install the Android toolchain.** JDK 17 and the Android SDK build tools;
      Bubblewrap can fetch both on first run.
  - [ ] Install `@bubblewrap/cli` **globally**. It must never become a project dependency: it would
        pull an Android toolchain into `devDependencies` and `pnpm-lock.yaml`, and not one of the
        four pre-commit checks needs it. This is an explicit exception to the pnpm-only rule, not a
        violation of it — record it in `AGENTS.md`.

- [ ] **Step 6 — Generate the shell.** Run `bubblewrap init` against the deployed manifest URL from
      step 1, inside `android/`.
  - [ ] Choose the **application id** carefully. It is reverse-DNS, it is permanent after first
        publish, and it is the one string in this plan that genuinely cannot be changed later.
  - [ ] At the prompts: keep the manifest's name and short name, standalone display, the page colour
        for both theme and background, the 512 icon as the splash source, the any/default
        orientation from step 2, and **decline notification delegation** — the app has no push and
        requesting the permission would be an unexplained permission on the listing.
  - [ ] Confirm the resulting `twa-manifest.json` matches the deployed manifest field for field.

- [ ] **Step 7 — Generate and protect the signing key.**
  - [ ] Create the upload keystore outside the repository, or inside it and ignored — never
        tracked. Store the passwords in a password manager, not in the repo and not in a shell
        history.
  - [ ] Note the accurate recovery position, because the folklore overstates it: with **Play App
        Signing** enabled, Google holds the app signing key and a lost _upload_ key can be reset
        through Play Console support. Losing the keystore is therefore a serious inconvenience and a
        support round-trip, not the end of the app's update path. Back it up anyway.
  - [ ] Add to `.gitignore`: keystore and JKS files, `android/build/`, `android/app/build/`,
        `android/.gradle/`, and `local.properties`. Append the block **below** the existing `.env`
        family and introduce no new `.env*` pattern — that file's negation-last rule is load-bearing
        and has already been broken once by a CLI.

- [ ] **Step 8 — Check the target SDK.** Read `targetSdkVersion` in the generated Gradle files and
      compare it against Play's current minimum for new apps, which advances every August. Bump it
      if Bubblewrap's default is behind. Record the value and the date checked.

- [ ] **Step 9 — First local build and install.** Run `bubblewrap build` to produce the AAB and the
      accompanying APK; install the APK on a real device.
  - [ ] **Expect a URL bar at this stage.** Asset links are not verified yet, so this is the correct
        intermediate state — confirming it now is what makes step 12's disappearance meaningful
        evidence rather than a coincidence.
  - [ ] Confirm the app launches, deals a deck, plays a preview and flips a card inside the shell.

- [ ] **Step 10 — Create the Play Console app.** Pay the one-time 25 USD registration fee and
      complete identity verification for the personal account. Create the app: name, default
      language, Games category with a music/trivia subcategory, free, not primarily child-directed.

- [ ] **Step 11 — Upload to internal testing and read both fingerprints.** Upload the AAB to the
      internal testing track. Then open the app signing page and copy **two** SHA-256 fingerprints:
      the **app signing key** (Google's, used for what users install) and the **upload key**
      (yours, used for local installs).

- [ ] **Step 12 — Complete the asset links and prove verification.** This step is the pass/fail
      gate for the whole approach.
  - [ ] Put **both** fingerprints in `public/.well-known/assetlinks.json` and redeploy. One
        fingerprint is the classic mistake: including only the upload key means store installs show
        a URL bar, and including only the app signing key means your own local installs do.
  - [ ] Reinstall and confirm there is **no URL bar**. If one appears, the fingerprints or the
        package id disagree with the build — do not proceed until it is gone.
  - [ ] Confirm the Android system verifier actually accepted the statement, via the device's
        deep-link verification report rather than by inferring it from the missing URL bar.
  - [ ] Confirm as a bonus that a shared deck link opens the installed app as an Android App Link.

- [ ] **Step 13 — Build the store listing.** Author the copy in `docs/store/` so it is reviewable,
      then paste it into the Console.
  - [ ] Short description within 80 characters; full description within 4000.
  - [ ] Verify `pwa-512x512.png` meets Play's icon spec, and produce a 1024×500 feature graphic and
        at least two phone screenshots. The PWA icons carry no wordmark, so the rename to "Playlist
        Jitster" does not invalidate any existing artwork.
  - [ ] **Trademark pass.** "Hitster" is a registered board-game mark and Play acts on IP
        complaints. The listing must not use it. Audit the app's own player-visible copy too — and
        note that the internal uses of the word are deliberate and must stay: the 65 mm card
        geometry in `pdf-sheet.ts`, the dropped-card messages in `reducer.ts` and `messages.ts`,
        `CardRevealSide`, the storage key names, and the package name. Renaming any of those either
        corrupts the reasoning or silently discards a player's saved game.

- [ ] **Step 14 — Policy declarations.**
  - [ ] Data safety form, using the flows enumerated in step 3. The honest position is close to "no
        data collected", but it must account for the playlist id and the track/artist strings leaving
        the device, for the Upstash cache being server-side storage, and for Spotify receiving the
        player's IP when audio is fetched.
  - [ ] Content rating questionnaire. Note the user-generated-content question needs thought: the
        app renders arbitrary track titles from a player-chosen public playlist, so it displays text
        the developer does not control.
  - [ ] Ads: none. Target audience: not child-directed, to stay outside the Families policy.
        Privacy policy URL from step 3.

- [ ] **Step 15 — Read the pre-launch report.** It runs the app on real devices and reports crashes
      and accessibility findings. This overlaps directly with the manual passes still outstanding in
      `docs/development.md` §5, and is the first automated device coverage this project has ever
      had. Fix anything real before production rather than after.

- [ ] **Step 16 — Closed testing milestone.** Create a closed track and recruit **twelve or more
      testers, opted in and kept opted in for fourteen continuous days**. This is the calendar
      critical path for a personal account. Land plan 2 inside this window.

- [ ] **Step 17 — Apply for production access, then roll out.** Submit the application after the
      fourteen days, then release to production as a **staged rollout** rather than at 100%, so a
      crash surfaced by real installs can be halted.

- [ ] **Step 18 — Record the release process.** Write the toolchain, build, upload and rollout steps
      into `docs/development.md` while they are fresh. A release process rediscovered in six months
      is a release that does not happen.

---

## Unit Tests

Every test below is a **node** test needing no DOM, consistent with this repo's default environment.

- [ ] `should declare the fields Bubblewrap and the store read` — covers the added `id`, `lang`,
      `dir` and `categories` in `src/pwa/manifest.test.ts`.
- [ ] `should keep id equal to start_url` — covers the store-identity invariant in
      `src/pwa/manifest.test.ts`. A divergence here creates a second app rather than an update, and
      nothing else in the toolchain would say so.
- [ ] `should not declare an orientation` — covers the deliberate absence in
      `src/pwa/manifest.test.ts`. This is the highest-value new assertion in the file: the value is
      absent on purpose, an interactive prompt during packaging is exactly the pressure that adds
      it, and adding it silently breaks landscape play that the card clamp was designed to support.
- [ ] `should be valid JSON containing exactly one delegate_permission statement` — covers the shape
      of `public/.well-known/assetlinks.json` in new `src/pwa/assetlinks.test.ts`.
- [ ] `should target the android_app namespace and the committed package id` — covers the target
      block in `src/pwa/assetlinks.test.ts`.
- [ ] `should list two colon-separated SHA-256 fingerprints` — covers the upload-key/app-signing-key
      pair in `src/pwa/assetlinks.test.ts`, asserting the count and the fingerprint format. One
      fingerprint is a valid file that produces a URL bar, which is the failure this catches.
- [ ] `should agree with android/twa-manifest.json about the package id` — covers the cross-file pin
      in `src/pwa/assetlinks.test.ts`. Two files hold the same string, neither can derive it from the
      other, and a mismatch fails silently on a device: the same situation as `PAGE_COLOR` and
      `--color-page`, handled the same way.
- [ ] `should ship a non-empty privacy policy page` — covers the existence of `public/privacy.html`
      in `src/pwa/assetlinks.test.ts` or a sibling. Cheap insurance against a listing that links to a 404.

**What these tests cannot prove, stated so nobody mistakes green for verified:** that Android's
verifier accepted the fingerprints, that the URL bar is gone, that the AAB installs, or that the
listing is compliant. Those are steps 9, 12, 15 and 17, all manual, all requiring a device and a
Console. This is the same honesty the repo already applies to `index.css.test.ts` — pin both ends of
the contract and be explicit that the middle is untestable here.

---

## Documentation Updates

- [ ] `AGENTS.md` — add both plan files to the Documentation Index table. Add the rules this tree
      introduces: `android/` is a fourth top-level tree with none of the `src`/`api`/`shared` import
      constraints; `@bubblewrap/cli` is global-only and must never enter `devDependencies`; the
      keystore is never committed; and the application id, `manifest.id` and `start_url` are
      **permanent after first publish**.
- [ ] `docs/architecture.md` §3 — a subsection on the TWA: that the store build is the deployed site
      rather than a copy, that Digital Asset Links makes the origin a second consumer of the
      production alias, and why Capacitor was rejected (it would break redeploy-updates-installs and
      force CORS onto both handlers).
- [ ] `docs/development.md` — a new section holding the Android release process end to end, and the
      pinned production origin from step 1. Add rows to §5 for the checks the TWA introduces: no URL
      bar, the PDF export's download behaviour **inside the shell** rather than in Chrome, and a
      re-run of the lock-screen audio check inside the shell.
- [ ] `docs/agent_findings.md` — dated entries for step 4's three findings, for whether
      `bubblewrap update` regenerates the Gradle project from a committed `twa-manifest.json` alone
      (this decides whether the generated project must be tracked), and for the Play target-SDK
      minimum on the day it was checked.
- [ ] `docs/plans/plan.md` — a row for the shipping phase, so the phase ladder does not stop at 8
      while a release exists.
- [ ] `README.md` — an install line, and a pointer to the release process section.
- [ ] `src/pwa/manifest.ts` — extend the doc comment: why `id` is now explicit, and that the absence
      of `orientation` is pinned by a test because a packaging prompt is what threatens it.
- [ ] `public/privacy.html` — a deliverable in its own right, from step 3.
- [ ] `docs/store/` — the listing copy, kept in the repo so a future release does not rewrite it
      from memory.

---

## Testing Strategy

- **Unit tests:** the manifest fields, the asset-links file's shape and fingerprint count, and the
  package-id cross-pin. All node environment, all fast, all guarding silent failures.
- **Integration tests:** none are possible. There is no environment in this repo that can run
  Android's asset-link verifier, install an AAB, or exercise a Play track. Recording that plainly is
  better than a test that appears to cover it.
- **Manual verification:** step 9 (launch in the shell, with the URL bar expected), step 12 (URL bar
  gone, verifier report, deep link opens the app), step 13's trademark pass, step 15's pre-launch
  report, and the new `docs/development.md` §5 rows for the PDF download and lock-screen audio
  inside the shell.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                       | Rationale                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Bubblewrap CLI over PWABuilder over Capacitor.                                              | Official toolchain, reproducible from a committed config, and zero application-code change. PWABuilder cannot satisfy "committed to this repo"; Capacitor breaks redeploy-updates-installs and forces CORS onto both handlers for no store-facing gain. |
| 2   | Bound to the `*.vercel.app` production alias, not a custom domain.                          | Developer's choice. Works technically — asset links are per-origin. The cost is recorded in Open Questions: moving to a custom domain later requires a new app release.                                                                                 |
| 3   | The alias, never a per-deployment URL.                                                      | Deployment URLs change on every push. A TWA bound to one breaks on the next deploy, with no error the user could interpret.                                                                                                                             |
| 4   | Personal developer account, so the twelve-tester / fourteen-day closed test is a milestone. | Google requires it for personal accounts before production access. It is the calendar critical path and cannot be shortened, only overlapped.                                                                                                           |
| 5   | `android/twa-manifest.json` is committed; the generated Gradle project's tracking is TBD.   | The config is what makes a release reproducible. Whether the generated project must also be tracked depends on whether `bubblewrap update` regenerates it — verified, not assumed.                                                                      |
| 6   | `@bubblewrap/cli` installed globally, never as a project dependency.                        | It would pull an Android toolchain into `devDependencies` and the lockfile, and no pre-commit check needs it. An explicit, recorded exception to the pnpm-only rule.                                                                                    |
| 7   | Both certificate fingerprints go in `assetlinks.json`, and the count is asserted by a test. | One fingerprint is a _valid file_ that produces a URL bar on either store installs or local installs. Nothing warns; a test is the only cheap guard.                                                                                                    |
| 8   | The placeholder asset-links file is deployed and verified before any keystore exists.       | It separates "is the file reachable and un-rewritten" from "are the fingerprints right". Debugging both at once, through a symptom as vague as a URL bar, is the avoidable version.                                                                     |
| 9   | `id` is added explicitly even though it changes nothing today.                              | It already defaults to `start_url`. Writing it down converts a future silent second-app-on-the-store into a failing test.                                                                                                                               |
| 10  | `orientation` stays absent and its absence gains a test.                                    | The `--card-height` clamp makes landscape a supported layout rather than a tolerated one. A packaging prompt is exactly the pressure that would lock rotation, invisibly.                                                                               |
| 11  | The privacy policy is a static `public/privacy.html`.                                       | The app has no router, and the dotted path bypasses the SPA rewrite. A route would mean adding routing to a single-screen app for one document.                                                                                                         |
| 12  | Lost upload keystore is recoverable via Play Console support.                               | With Play App Signing, Google holds the app signing key. Stating this accurately matters: the folklore version ("you can never update again") predates Play App Signing.                                                                                |
| 13  | Local builds now, GitHub Actions later.                                                     | One app, one maintainer, low cadence. CI would add secret handling to a repo that currently has no CI at all — worth doing when the cadence justifies it, not before.                                                                                   |
| 14  | Staged production rollout rather than 100%.                                                 | This app has never run on more than a handful of devices, and most of `docs/development.md` §5 is still Pending. A halt button is worth having.                                                                                                         |
| 15  | Store listing copy lives in `docs/store/`.                                                  | Console-only copy is unreviewable and unversioned. Every other decision in this repo is written down; the listing should not be the exception.                                                                                                          |

---

## Open Questions

- [ ] Which exact production alias is the binding origin? Needed by step 1, and permanent from step 6.
- [ ] What is the permanent application id string? Reverse-DNS, and genuinely unchangeable after
      first publish.
- [ ] Is moving to a custom domain foreseeable? If it is even plausible within a year, doing it
      _before_ step 6 is far cheaper than after — the origin is baked into the shell.
- [ ] Does the content rating questionnaire's user-generated-content question apply? The app renders
      arbitrary track titles from a player-chosen playlist, so it displays text the developer does
      not control.
- [ ] Must Vercel's access-log IP retention be declared in the Data safety form, or does it fall
      under the security-and-fraud exemption?
- [ ] Does `bubblewrap update` regenerate the Gradle project from `twa-manifest.json` alone? Resolves
      whether the generated project is tracked or ignored (decision 5).
- [ ] Does the listing name need more distance from the Hitster mark than "Playlist Jitster" already
      provides?
- [ ] Does the PDF export's `doc.save()` download work inside the TWA? Chrome's own download path
      should handle it — unlike the iOS WKWebView case — but it is unverified, and a silently
      missing file is the failure mode.

---

## Out of Scope

- **The Android back button.** In `plan.google-play-back-button.md`, deliberately split so this plan
  can reach closed testing without waiting on an application-code change.
- **The App Store and iOS.** Explicitly discarded by the developer. No Capacitor, no Mac, no `$99`.
- **Adding CORS to `api/playlist.ts` and `api/year.ts`.** Only Capacitor would need it, and Capacitor
  was rejected.
- **CI-built releases.** Recorded as a follow-up once the release cadence justifies the secret
  handling.
- **Push notifications, Play Billing, in-app updates, Play Integrity, app shortcuts.** None are
  needed for a first release, and notification delegation is actively declined in step 6.
- **A custom domain.** Decision 2, with its cost recorded as an open question.
- **Closing the outstanding manual passes in `docs/development.md` §5** beyond whatever the
  pre-launch report surfaces. The screen-reader pass in particular remains owed and is not this
  task's deliverable.
- **Any change to the service worker's caching posture.** `runtimeCaching` stays empty; a store
  release does not change the reasoning that put it there.
