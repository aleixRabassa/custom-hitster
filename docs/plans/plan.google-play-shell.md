<!-- Plans for google-play (in order):
  1. plan.google-play-shell.md       — packaging the PWA as a Trusted Web Activity. STEPS 1-5 BUILT 2026-09-19; the rest is FROZEN and tracked in plan 3  ← this file
  2. plan.google-play-back-button.md — Android's back gesture as an in-app control. CODE BUILT 2026-08-12; its seven device rows are tracked in plan 3
  3. plan.play-store-todo.md         — everything still between the committed repo work and a staged production rollout. THE ONLY EXECUTABLE ONE
-->

# Plan: google-play — Ship the app to Google Play (TWA shell and store release)

> **Task:** `google-play`
> **Date:** 2026-08-11 · **Reviewed against the repo:** 2026-09-19 (at review time nothing had been
> started) · **Executed:** 2026-09-19 — steps 1-5 are done, and every remaining step needs something
> this repo does not contain: a deploy, an Android device, or a Play Console account
> **Author:** Aleix Rabassa
> **Depends on:** nothing. This is plan 1 of 2 and is independently shippable. Plan 2's code is already in `main`, so this plan's installs are also where plan 2's seven device rows get run.

> **FROZEN 2026-09-19.** Steps 1–5 are built. Every unfinished box below is owned by a step in
> [`plan.play-store-todo.md`](plan.play-store-todo.md), named under each step, and is ticked only when
> that step ticks. Point `/plan-exec` at that file, never at this one.

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

**What changed between the plan's date and its review (2026-09-19), and where each change lands
below.** The app grew a **welcome screen** in front of the picker (2026-09-18) — so a cold launch of
the TWA shows the front door every time, by a recorded decision (step 6, step 13's screenshots, and a
new manual row). It gained a **static PDF download** (`public/year-cards-1970-2033.pdf`, an
`<a download>`), which is a second download path through the shell beside jsPDF's `doc.save()` (new
manual row; open question). The **PWA icons now carry a wordmark** — the 2026-08-12 artwork reads
"PLAYLIST JITSTER" — which reverses a claim this plan made in step 13. **Plan 2 landed**, so the
sequencing note below is rewritten. And the machine this would run on had **no JDK, no Android SDK
and no Bubblewrap** as of the review, while Bubblewrap itself is at **1.25.0** (published
2026-09-16), so step 5 was a real install rather than a check.

**What was executed on 2026-09-19, the same day as the review.** Steps 1-5 are done: the origin is
pinned and measured, the manifest carries `id`/`lang`/`dir`/`categories`, `public/privacy.html` and
the placeholder `public/.well-known/assetlinks.json` exist with seven new node tests behind them, the
`.gitignore` block from step 7 is in, and the toolchain is installed and passing `bubblewrap doctor`.
**Everything from step 6 on is blocked on something this repo does not contain** — a deploy, an
Android device, or a Play Console account — and `bubblewrap init` and `bubblewrap build` are
interactive besides, so they are typed by a person rather than run by an agent. Three sub-items
inside the finished steps are deploy-dependent and stay open: step 3's served-page check, step 4's
production fetch, and the third of its three findings.

---

## Dependency Contract

### Produces for downstream plans

| Output                                | Consumed by                    | Description                                                                                                                                                                   |
| ------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An installed, asset-link-verified TWA | `plan.google-play-back-button` | The back-button behaviour cannot be observed in a browser, because a browser has its own back affordance and its own history. Verification requires this build on a device.   |
| The permanent application id          | `plan.google-play-back-button` | Only for the device-install instructions in that plan's manual checks.                                                                                                        |
| The step 9 and step 12 installs       | `plan.google-play-back-button` | Where that plan's seven device rows are run — the only work it has left. Was "the closed-testing track, as a landing window" until 2026-09-19; see the sequencing note below. |

**Sequencing note — rewritten 2026-09-19.** The original note planned for plan 2 to land _inside_
this plan's fourteen-day closed test. Plan 2's code landed on 2026-08-12 instead, before this plan
started, so the deployed site already carries the back-press interception and there is nothing to
overlap. What plan 2 still owes is its **step 5, seven device rows** (`docs/development.md` §5, "The
Android back press"), and they run on this plan's installs: the first six on the step 9 URL-bar
build (the unverified shell is a Custom Tab with what should be the same history stack, so the history
behaviour should not depend on asset-link verification — an expectation, not a measurement; if those
rows behave differently there, re-run on step 12 before concluding anything), all seven again on the
step 12 verified build. Row 7 — Android 13+ predictive back — is the one that can send work back into
`android/`, so run it before the AAB that goes to closed testing is final.

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
| `visual-assets/`               | New             | Listing copy and graphics, so the store listing is reviewable and reproducible rather than living only in the Console.                    |
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

- [x] **Step 1 — Pin the origin.** Everything downstream is bound to one origin permanently, so
      establish it before generating anything.
  - [x] Identify the **stable production alias** on Vercel, not a per-deployment URL. Deployment
        URLs change on every push; an alias does not, and a TWA bound to a deployment URL breaks on
        the next deploy. **DECIDED 2026-09-19: the origin is `https://playlistjitster.vercel.app`.**
        Measured the same day: it answers `200` from Vercel and serves `manifest.webmanifest` at its
        root (name "Playlist Jitster", `start_url: '/'`, `standalone`), and the older
        `custom-hitster.vercel.app` — the origin the 2026-08-04 probe deploy answered on — now
        `307`-redirects to it. Two consequences of the redirect: the TWA must be bound to the NEW
        host and never the old one (a TWA whose origin redirects is treated as leaving the verified
        origin, which is a URL bar), and the `assetlinks.json` is fetched by the verifier from the
        new host only, so the old alias needs nothing. `.vercel/repo.json` still links this checkout
        to the project `custom-hitster`; that is the project's internal name and is unaffected.
  - [x] Confirm `manifest.webmanifest` is served at that origin's root, and that `index.html` in the
        built output carries the injected `<link rel="manifest">` and the worker registration
        script. Neither is written by hand — `vite-plugin-pwa` injects both — so confirm rather than
        assume.
  - [x] Record the origin in `docs/development.md` as the one value later steps read.

- [x] **Step 2 — Complete the manifest.** In `src/pwa/manifest.ts`, add the fields Bubblewrap and
      Play read and that are currently absent.
  - [x] Add `id` set to the same value as `start_url`. This is explicit-not-new: the spec already
        defaults `id` to `start_url`, so writing it changes nothing today and prevents a future
        `start_url` edit from silently minting a **second app** on the store.
  - [x] Add `lang` and `dir`, which Bubblewrap prompts for and Play uses for the default listing
        language. Every player-visible string is English (`src/game/copy.ts`), so `lang: 'en'`,
        `dir: 'ltr'`.
  - [x] Add `categories` naming games and music. All four fields are already typed on
        `ManifestOptions` in the installed `vite-plugin-pwa` (checked 2026-09-19: `id`, `lang`,
        `dir: 'ltr' | 'rtl'`, `categories: string[]`), so this is a value change with no type work.
  - [x] **Do not add `orientation`.** Its absence is a decision recorded in that file's doc comment
        (the `--card-height` clamp exists precisely so a short wide viewport gets a smaller card),
        and Bubblewrap will prompt for it — answer with the any/default option so the generated
        project does not lock rotation. Extend the doc comment to say the absence is now pinned by a
        test, and why the prompt is the thing that threatens it.
  - [x] Do not touch `name`, `short_name`, `start_url`, `display`, the colours or the icons.

- [x] **Step 3 — Write the privacy policy.** Create `public/privacy.html` as a self-contained
      static page. It must accurately describe, at minimum: the two `localStorage` keys and that
      they never leave the device; that a playlist id is sent to this app's own function to read the
      public Spotify embed; that a track title and artist are sent to the year function and cached
      server-side in Upstash with a TTL; that preview audio and the embed are fetched by the browser
      directly from Spotify, so Spotify receives the player's IP address; that MusicBrainz is
      contacted server-side and therefore does not see the player; and that there are no accounts,
      no ads, no analytics and no third-party SDKs. Include a contact address. Two things the shell
      adds to that list: the TWA itself collects nothing (no Play SDKs, notification delegation
      declined in step 6), and the static year-cards PDF is a file download with no data attached.
      **Correction (2026-09-19), because step 14's Data safety form reads this enumeration and would
      inherit both errors:** the year function is sent the track's title, artist **and duration**, not
      two fields (`src/game/year-client.ts`); and the **embed is fetched server-side**, by
      `api/playlist.ts`, not by the browser — there is no `iframe` anywhere in `src/`. So the only
      thing that reaches Spotify from the player's own device is the **preview audio**, and only once
      Play is pressed, because the `<audio>` element is `preload="none"`. `public/privacy.html` was
      written from the code and says the corrected version; declare the form from the page, not from
      this paragraph.
  - [x] Verify after deploy that the page is served rather than swallowed by the SPA rewrite. The
        rewrite source in `vercel.json` is `/((?!api/|@)[^.]*)` — the `[^.]*` excludes any path
        containing a dot, so `/privacy.html` passes through, exactly as `/robots.txt` and the
        year-cards `.pdf` already do. Confirm it anyway, because a listing pointing at a 404 is a
        review rejection. (`docs/architecture.md` §6 quoted an older form of this rewrite without the
        dot exclusion until 2026-09-19; it now matches the file.)

- [x] **Step 4 — Serve a placeholder `assetlinks.json` and verify the path end to end.** Do this
      **before** any keystore exists, because it isolates the two things that can go wrong.
  - [x] Create `public/.well-known/assetlinks.json` with the correct statement-list shape — a single
        statement delegating `common.handle_all_urls`, targeting the `android_app` namespace, naming
        the application id, with an empty fingerprint list for now. **Write only the SHAPE tests at
        this step** (valid JSON, one statement, `android_app`, the package id) — the two-fingerprint
        count and the `twa-manifest.json` cross-pin belong to step 12, because neither the
        fingerprints nor `android/` exist yet and a test that is red for eight steps gets skipped
        rather than trusted.
  - [x] Confirm `vite build` copies the **dot-directory** out of `public/` into `dist/`. This is the
        step most likely to surprise; verify it against the build output rather than trusting it.
  - [x] Deploy, then fetch the file from the production origin and confirm it returns the JSON with a
        JSON content type and is **not** rewritten to `index.html`.
  - [x] Confirm the file is absent from the generated precache manifest — `globPatterns` in
        `vite.config.ts` does not list `json`, so it should be. Asset-link verification is performed
        by the Android system rather than by the webview, so a cached copy would be wrong as well as
        useless.
  - [x] Record all three findings, dated, in `docs/agent_findings.md`.
        _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 2 (the deploy happened with commit `8801190`; the fetches are recorded there). Do not execute from here._

- [x] **Step 5 — Install the Android toolchain.** JDK 17 and the Android SDK build tools;
      Bubblewrap offers to fetch both on first run. **As of 2026-09-19 this machine had none of the
      three**: `java` was not on the PATH, `ANDROID_HOME` was unset, and `bubblewrap` was not
      installed — so this was an install, not a check. **DONE 2026-09-19**, and neither half went the
      documented way: Bubblewrap cannot be driven by a non-interactive shell at all, the current
      command-line tools have retired `sdkmanager`, and Bubblewrap then rejects a correctly installed
      SDK because it looks for the pre-2020 layout. Versions, the working invocations and the two
      workarounds are in `docs/development.md` §9 and `docs/agent_findings.md` (2026-09-19). `java` is
      still not on the PATH and `ANDROID_HOME` is still unset — Bubblewrap needs neither, because it
      keeps both paths in `~/.bubblewrap/config.json`.
  - [x] Install `@bubblewrap/cli` **globally** (`npm i -g @bubblewrap/cli`; current release 1.25.0,
        published 2026-09-16). It must never become a project dependency: it would pull an Android
        toolchain into `devDependencies` and `pnpm-lock.yaml`, and not one of the four pre-commit
        checks needs it. This is an explicit exception to the pnpm-only rule, not a violation of it —
        record it in `AGENTS.md`. Record the installed Bubblewrap, JDK and build-tools versions in
        `docs/development.md` with the release process (step 18), because the next release will be
        run against whatever the machine has then.

- [x] **Step 6 — Generate the shell.** Run `bubblewrap init` against the deployed manifest URL from
      step 1, inside `android/`.
  - [x] Choose the **application id** carefully. It is reverse-DNS, it is permanent after first
        publish, and it is the one string in this plan that genuinely cannot be changed later. **Do
        not accept Bubblewrap's default.** It derives one from the origin's host reversed, which for
        the candidate origin puts the app under `app.vercel.…` — a namespace the developer does not
        own, and a name that stays wrong forever if the site ever moves to a custom domain, since the
        id cannot follow. **DECIDED 2026-09-19: the application id is
        `aleixrabassa.playlistjitster`** — the developer's own name as the namespace (no domain is
        owned), two segments, letters only, which satisfies Android's rule (dot-separated segments,
        each starting with a letter, letters/digits/underscores only, no hyphens). Type it at the
        prompt exactly; Bubblewrap's proposed `app.vercel.playlistjitster` is the thing to overwrite.
        The same string goes into `public/.well-known/assetlinks.json` (step 4) and is what the
        step 12 cross-pin test compares against `twa-manifest.json`.
  - [x] At the prompts: keep the manifest's name and short name, standalone display, the page colour
        for both theme and background, the 512 icon as the splash source, the any/default
        orientation from step 2, and **decline notification delegation** — the app has no push and
        requesting the permission would be an unexplained permission on the listing. Also decline
        **Play Billing** and the **geolocation** permission when asked, keep the default
        **Custom Tabs fallback** (it is what a device without a TWA-capable browser gets), and leave
        the shortcuts list empty — the manifest declares none.
  - [x] Confirm the resulting `twa-manifest.json` matches the deployed manifest field for field.
  - [x] Note what the shell will open on: `start_url` is `/`, and since 2026-09-18 that is the
        **welcome screen**, on every cold launch, by a recorded decision (no "seen it" flag). That is
        correct and needs no packaging change — but it is what testers and reviewers will see first,
        so the listing's first screenshot should be it (step 13).
        _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 4. Do not execute from here.
        **Ticked from there 2026-09-20**, with one correction this plan could not have known: Bubblewrap
        1.25.0 has **no notification-delegation prompt**, and the field defaults to `true` — it was fixed
        by hand in `twa-manifest.json` and is now pinned by a test._

- [x] **Step 7 — Generate and protect the signing key.**
  - [x] Create the upload keystore outside the repository, or inside it and ignored — never
        tracked. Store the passwords in a password manager, not in the repo and not in a shell
        history.
  - [x] Note the accurate recovery position, because the folklore overstates it: with **Play App
        Signing** enabled, Google holds the app signing key and a lost _upload_ key can be reset
        through Play Console support. Losing the keystore is therefore a serious inconvenience and a
        support round-trip, not the end of the app's update path. Back it up anyway.
  - [x] Add to `.gitignore`: keystore and JKS files, `android/build/`, `android/app/build/`,
        `android/.gradle/`, and `local.properties`. Append the block **below** the existing `.env`
        family and introduce no new `.env*` pattern — that file's negation-last rule is load-bearing
        and has already been broken once by a CLI.
        _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 5. Do not execute from here.
        **Ticked from there 2026-09-20**; the `.gitignore` block was widened the same day to every path
        `bubblewrap update` regenerates._

- [x] **Step 8 — Check the target SDK.** Read `targetSdkVersion` in the generated Gradle files and
      compare it against Play's current minimum for new apps, which advances every August. Bump it
      if Bubblewrap's default is behind. Record the value and the date checked. **This plan was
      written before the August 2026 advance and is being executed after it**, so do not carry over
      any number remembered from the planning date: read the requirement in the Console's own
      policy page on the day, and read what Bubblewrap 1.25.0 actually emitted rather than what its
      changelog says.
      _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 6. Do not execute from here._

- [ ] **Step 9 — First local build and install.** Run `bubblewrap build` to produce the AAB and the
      accompanying APK; install the APK on a real device.
  - [ ] **Expect a URL bar at this stage.** Asset links are not verified yet, so this is the correct
        intermediate state — confirming it now is what makes step 12's disappearance meaningful
        evidence rather than a coincidence.
  - [ ] Confirm the app launches on the welcome screen, enters the picker, deals a deck, plays a
        preview and flips a card inside the shell.
  - [ ] **Run plan 2's device rows 1–6 here** (`docs/development.md` §5, "The Android back press").
        They should not depend on asset-link verification (a Custom Tab has the same history stack
        as a verified TWA — expected, not yet observed), and finding a problem now is cheaper than
        finding it on the verified build. A row that fails here and passes on step 12 is itself a
        finding worth writing down.
  - [ ] **Both PDF downloads inside the shell.** The welcome screen's static `<a download>` of
        `year-cards-1970-2033.pdf`, and a deck's `Print as PDF cards` (jsPDF's `doc.save()`). Both go
        through Chrome's download manager rather than a WebView's, which is why they should work —
        but neither has been seen anywhere outside jsdom, the static one has a service-worker
        denylist entry that no dev server can exercise, and a silently missing file is the failure
        mode. The service-worker half only becomes observable on the SECOND launch, once `sw.js`
        controls the page.
  - [ ] **Storage is shared with Chrome.** A Chrome TWA runs in Chrome's own profile, so
        `hitster:session:v1` and `hitster:library:v1` on the origin are the same storage the Chrome
        browser sees. Verify by starting a game in the installed app, opening the origin in Chrome
        and seeing it resume (and the reverse). Not a defect — but a tester who does not know it
        will report "the app remembered a game I never played in it", so it goes in the tester notes
        and in `docs/development.md` §8.
        _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 7. Do not execute from here._

- [ ] **Step 10 — Create the Play Console app.** Pay the one-time 25 USD registration fee and
      complete identity verification for the personal account. Create the app: name, default
      language, Games category with a music/trivia subcategory, free, not primarily child-directed.
      _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) steps 1 (account and identity verification, day 0) and 9 (the app). Do not execute from here._

- [ ] **Step 11 — Upload to internal testing and read both fingerprints.** Upload the AAB to the
      internal testing track. Then open the app signing page and copy **two** SHA-256 fingerprints:
      the **app signing key** (Google's, used for what users install) and the **upload key**
      (yours, used for local installs).
      _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 10. Do not execute from here._

- [ ] **Step 12 — Complete the asset links and prove verification.** This step is the pass/fail
      gate for the whole approach.
  - [ ] Put **both** fingerprints in `public/.well-known/assetlinks.json` and redeploy. One
        fingerprint is the classic mistake: including only the upload key means store installs show
        a URL bar, and including only the app signing key means your own local installs do.
        Bubblewrap can hold both and write the file for you — `bubblewrap fingerprint add <sha256>`
        for each, then `bubblewrap fingerprint generateAssetLinks` — which keeps `twa-manifest.json`
        as the record of which fingerprints a release carried. Copy its output into `public/`
        rather than hand-editing two files.
  - [ ] **Now write the two tests deferred from step 4**: the fingerprint count and format, and the
        package-id cross-pin against `android/twa-manifest.json`.
  - [ ] Reinstall and confirm there is **no URL bar**. If one appears, the fingerprints or the
        package id disagree with the build — do not proceed until it is gone.
  - [ ] Confirm the Android system verifier actually accepted the statement, via the device's
        deep-link verification report rather than by inferring it from the missing URL bar. The
        instruments, none of which the plan named before:
        `adb shell pm get-app-links <application id>` must list the origin's host as `verified`;
        `adb shell pm verify-app-links --re-verify <application id>` forces a fresh attempt after a
        redeploy (the system otherwise re-checks on its own schedule); and Google's own checker at
        `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=<origin>&relation=delegate_permission/common.handle_all_urls`
        shows what the verifier fetches, so a wrong content type or a rewrite to `index.html` is
        visible there without a device.
  - [ ] Confirm as a bonus that a shared deck link opens the installed app as an Android App Link.
        The link is `<origin>/?playlist=<ids>&seed=<hex>` — the query string must survive into the
        activity, because `App.tsx` reads it in a lazy initialiser on first render, and a link that
        opens the app on a bare `/` would silently show the welcome screen instead of dealing.
  - [ ] **Re-run all seven plan-2 rows on this build**, including row 7 (predictive back). This is
        the build that reaches testers, and row 7 is the one that can require a change in `android/`.
        _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) steps 11 and 12. Do not execute from here._

- [ ] **Step 13 — Build the store listing.** Author the copy in `visual-assets/` so it is reviewable,
      then paste it into the Console.
  - [ ] Short description within 80 characters; full description within 4000.
  - [ ] Verify `pwa-512x512.png` meets Play's icon spec, and produce a 1024×500 feature graphic and
        at least two phone screenshots — the first of them the welcome screen, because that is what
        a cold launch shows. **Correction (2026-09-19): the PWA icons DO carry a wordmark.** This
        plan said they did not; they did at the time too (they read "PLAYLIST HITSTER" until the
        2026-08-12 artwork replaced them, and AGENTS.md records that nobody had opened the image).
        Since 2026-08-12 every icon is a downscale of `visual-assets/logo-master/logo.png`, which reads "PLAYLIST
        JITSTER" — so the artwork is consistent with the listing name, and the master to build the
        feature graphic from is that file, never anything in `public/`. Open the 512 and look at it
        before uploading: no check in this repo has ever opened an image.
  - [ ] **Trademark pass.** "Hitster" is a registered board-game mark and Play acts on IP
        complaints. The listing must not use it. Audit the app's own player-visible copy too — and
        note that the internal uses of the word are deliberate and must stay: the 65 mm card
        geometry in `pdf-sheet.ts`, the dropped-card messages in `reducer.ts` and `messages.ts`,
        `CardRevealSide`, the storage key names, and the package name. Renaming any of those either
        corrupts the reasoning or silently discards a player's saved game. **The audit has one
        concrete hit as of 2026-09-19**: `SUGGESTED_PLAYLISTS[0]` in `src/components/LandingScreen.tsx`
        is labelled `'Hitster'` — it is a rendering of that Spotify playlist's own title, but it is
        the text of a button on the picker, in screenshots and in front of every player. Decide it
        here: relabel it (the label is a readable rendering, not a quotation, per that file's own
        header) or replace the suggestion. Not decided by this plan, and not something to fix
        quietly in passing. Also grep `README.md`, which links to the board game by name — fine for a
        repository, not for listing copy.
        _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) steps 3 (the trademark relabel, decided `'Jitster official'`) and 13. Do not execute from here._

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
        _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 14. Do not execute from here._

- [ ] **Step 15 — Read the pre-launch report.** It runs the app on real devices and reports crashes
      and accessibility findings. This overlaps directly with the manual passes still outstanding in
      `docs/development.md` §5, and is the first automated device coverage this project has ever
      had. Fix anything real before production rather than after.
      _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 15. Do not execute from here._

- [ ] **Step 16 — Closed testing milestone.** Create a closed track and recruit **twelve or more
      testers, opted in and kept opted in for fourteen continuous days**. This is the calendar
      critical path for a personal account. Land plan 2 inside this window.
      _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 16. Do not execute from here._

- [ ] **Step 17 — Apply for production access, then roll out.** Submit the application after the
      fourteen days, then release to production as a **staged rollout** rather than at 100%, so a
      crash surfaced by real installs can be halted.
      _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 17. Do not execute from here._

- [ ] **Step 18 — Record the release process.** Write the toolchain, build, upload and rollout steps
      into `docs/development.md` while they are fresh. A release process rediscovered in six months
      is a release that does not happen.
      _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) step 18. Do not execute from here._

---

## Unit Tests

Every test below is a **node** test needing no DOM, consistent with this repo's default environment.
**They land in two batches, not one**: the manifest tests and the asset-links SHAPE tests at steps 2
and 4, the fingerprint count and the cross-pin at step 12 — because between steps 4 and 12 the
fingerprint list is deliberately empty and `android/` does not exist, and a test that stays red for
eight steps is a test people learn to skip.

- [x] `should declare the fields Bubblewrap and the store read` — covers the added `id`, `lang`,
      `dir` and `categories` in `src/pwa/manifest.test.ts`.
- [x] `should keep id equal to start_url` — covers the store-identity invariant in
      `src/pwa/manifest.test.ts`. A divergence here creates a second app rather than an update, and
      nothing else in the toolchain would say so.
- [x] `should not declare an orientation` — covers the deliberate absence in
      `src/pwa/manifest.test.ts`. This is the highest-value new assertion in the file: the value is
      absent on purpose, an interactive prompt during packaging is exactly the pressure that adds
      it, and adding it silently breaks landscape play that the card clamp was designed to support.
- [x] `should be valid JSON containing exactly one delegate_permission statement` — covers the shape
      of `public/.well-known/assetlinks.json` in new `src/pwa/assetlinks.test.ts`.
- [x] `should target the android_app namespace and the committed package id` — covers the target
      block in `src/pwa/assetlinks.test.ts`.
- [ ] `should list two colon-separated SHA-256 fingerprints` — **step 12.** Covers the
      upload-key/app-signing-key pair in `src/pwa/assetlinks.test.ts`, asserting the count and the
      fingerprint format. One fingerprint is a valid file that produces a URL bar, which is the
      failure this catches.
- [x] `should agree with android/twa-manifest.json about the package id` — **step 12.** _→ Written
      2026-09-23, tracked in `plan.play-store-todo.md`._ Covers the
      cross-file pin in `src/pwa/assetlinks.test.ts`. Two files hold the same string, neither can
      derive it from the other, and a mismatch fails silently on a device: the same situation as
      `PAGE_COLOR` and `--color-page`, handled the same way.
- [x] `should ship a non-empty privacy policy page` — covers the existence of `public/privacy.html`
      in `src/pwa/assetlinks.test.ts` or a sibling. Cheap insurance against a listing that links to a 404.
- [x] `should keep the SPA rewrite away from the well-known path and the policy` — added
      2026-09-19. Reads `vercel.json` and asserts its one rewrite `source` still contains the
      `[^.]*` dot exclusion, in the same file. Steps 3, 4 and the existing `.pdf` all lean on that
      one character class, `vercel.json` cannot carry a comment saying so, and nothing today would
      fail if a well-meaning edit widened it to `.*` — the asset-links file would come back as
      `index.html` with a 200, which is the URL bar with a green build. A string assertion over the
      pattern is the honest ceiling: path-to-regexp semantics are not worth re-implementing in a
      test, and the deployed behaviour is step 4's fetch.
      _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) Unit Tests batch B, step 11. Do not execute from here._
      _→ Frozen; tracked in [`plan.play-store-todo.md`](plan.play-store-todo.md) Unit Tests batch B, step 11. Do not execute from here._

**What these tests cannot prove, stated so nobody mistakes green for verified:** that Android's
verifier accepted the fingerprints, that the URL bar is gone, that the AAB installs, or that the
listing is compliant. Those are steps 9, 12, 15 and 17, all manual, all requiring a device and a
Console. This is the same honesty the repo already applies to `index.css.test.ts` — pin both ends of
the contract and be explicit that the middle is untestable here.

---

## Documentation Updates

- [x] `AGENTS.md` — add both plan files to the Documentation Index table. _Done 2026-09-19, during
      the review; they had been missing since 2026-08-11._
- [x] `AGENTS.md` — add the rules this tree introduces: `android/` is a fourth top-level tree with
      none of the `src`/`api`/`shared` import constraints; `@bubblewrap/cli` is global-only and must
      never enter `devDependencies`; the keystore is never committed; the application id,
      `manifest.id` and `start_url` are **permanent after first publish**; and the TWA shares
      `localStorage` with Chrome on the same origin, so the two storage keys are one store seen from
      two launchers.
- [x] `docs/architecture.md` §3 — a subsection on the TWA: that the store build is the deployed site
      rather than a copy, that Digital Asset Links makes the origin a second consumer of the
      production alias, and why Capacitor was rejected (it would break redeploy-updates-installs and
      force CORS onto both handlers).
- [x] `docs/development.md` — a new section holding the Android release process end to end, the
      pinned production origin from step 1, and the toolchain versions from step 5. Add rows to §5
      for the checks the TWA introduces: no URL bar; **both** PDF downloads inside the shell (the
      welcome screen's static file and the deck export); the shared-link App Link carrying its query
      string; the storage shared with Chrome; a re-run of the lock-screen audio check inside the
      shell; and a note on the existing back-press table that its rows now have a build to run on.
      Add the shared-storage behaviour to §8 as a documented property rather than a limitation.
- [x] `docs/agent_findings.md` — dated entries for step 4's three findings, for whether
      `bubblewrap update` regenerates the Gradle project from a committed `twa-manifest.json` alone
      (this decides whether the generated project must be tracked), and for the Play target-SDK
      minimum on the day it was checked. _All three done: the first two 2026-09-20, the target-SDK
      minimum 2026-09-21._
- [x] `docs/plans/plan.md` — an entry under Post-Phase-8 naming both plans and their status. _Done
      2026-09-19; update its status line when this plan reaches closed testing and again at
      production._
- [x] `README.md` — an install line, and a pointer to the release process section. _Done 2026-09-19:
      a "Google Play" section pointing at `docs/development.md`'s Android release section, at this
      plan and at `visual-assets/`. **The install line itself is deliberately deferred** — there is no
      listing and no store URL, and a badge linking nowhere is worse than its absence. It lands with
      step 17._
- [x] `src/pwa/manifest.ts` — extend the doc comment: why `id` is now explicit, and that the absence
      of `orientation` is pinned by a test because a packaging prompt is what threatens it.
- [x] `public/privacy.html` — a deliverable in its own right, from step 3.
- [x] `visual-assets/` — the listing copy, kept in the repo so a future release does not rewrite it
      from memory. _Done 2026-09-19: `visual-assets/listing.md` holds the trademark rule, a short
      description with two alternates, the full description (2150 of 4000 characters), an assets
      checklist and the category/declaration values. **Step 13 itself stays open** — it needs the
      graphics, the screenshots and the Console — and the listing is blocked on the undecided
      `'Hitster'` suggestion label._

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

| #   | Assumption / Decision                                                                                                | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Bubblewrap CLI over PWABuilder over Capacitor.                                                                       | Official toolchain, reproducible from a committed config, and zero application-code change. PWABuilder cannot satisfy "committed to this repo"; Capacitor breaks redeploy-updates-installs and forces CORS onto both handlers for no store-facing gain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | Bound to the `*.vercel.app` production alias, not a custom domain.                                                   | Developer's choice. Works technically — asset links are per-origin. The cost is recorded in Open Questions: moving to a custom domain later requires a new app release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3   | The alias, never a per-deployment URL.                                                                               | Deployment URLs change on every push. A TWA bound to one breaks on the next deploy, with no error the user could interpret.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4   | Personal developer account, so the twelve-tester / fourteen-day closed test is a milestone.                          | Google requires it for personal accounts before production access. It is the calendar critical path and cannot be shortened, only overlapped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 5   | `android/twa-manifest.json` is committed; the generated Gradle project **need not be tracked**. RESOLVED 2026-09-19. | The config is what makes a release reproducible. `bubblewrap update` deletes the generated project outright (`settings.gradle`, `build.gradle`, `gradlew`, `gradle/`, `app/`, …) and rebuilds it from `twa-manifest.json` plus re-fetched icons, so tracking it would only commit output. **Consequence for step 8:** `app/build.gradle` is a regenerated template, so a hand-edited `targetSdkVersion` is silently discarded — the bump belongs in the manifest. Read out of the installed CLI 1.25.0; see `docs/agent_findings.md` (2026-09-19). **The matching `.gitignore` entries land at step 6**, when the files first exist — today's block covers only the build output, which is why step 7's list is not yet the whole `DELETE_PROJECT_FILE_LIST`. |
| 6   | `@bubblewrap/cli` installed globally, never as a project dependency.                                                 | It would pull an Android toolchain into `devDependencies` and the lockfile, and no pre-commit check needs it. An explicit, recorded exception to the pnpm-only rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 7   | Both certificate fingerprints go in `assetlinks.json`, and the count is asserted by a test.                          | One fingerprint is a _valid file_ that produces a URL bar on either store installs or local installs. Nothing warns; a test is the only cheap guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8   | The placeholder asset-links file is deployed and verified before any keystore exists.                                | It separates "is the file reachable and un-rewritten" from "are the fingerprints right". Debugging both at once, through a symptom as vague as a URL bar, is the avoidable version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 9   | `id` is added explicitly even though it changes nothing today.                                                       | It already defaults to `start_url`. Writing it down converts a future silent second-app-on-the-store into a failing test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 10  | `orientation` stays absent and its absence gains a test.                                                             | The `--card-height` clamp makes landscape a supported layout rather than a tolerated one. A packaging prompt is exactly the pressure that would lock rotation, invisibly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | The privacy policy is a static `public/privacy.html`.                                                                | The app has no router, and the dotted path bypasses the SPA rewrite. A route would mean adding routing to a single-screen app for one document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 12  | Lost upload keystore is recoverable via Play Console support.                                                        | With Play App Signing, Google holds the app signing key. Stating this accurately matters: the folklore version ("you can never update again") predates Play App Signing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 13  | Local builds now, GitHub Actions later.                                                                              | One app, one maintainer, low cadence. CI would add secret handling to a repo that currently has no CI at all — worth doing when the cadence justifies it, not before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 14  | Staged production rollout rather than 100%.                                                                          | This app has never run on more than a handful of devices, and most of `docs/development.md` §5 is still Pending. A halt button is worth having.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 15  | Store listing copy lives in `visual-assets/`.                                                                  | Console-only copy is unreviewable and unversioned. Every other decision in this repo is written down; the listing should not be the exception.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 16  | The application id is developer-owned reverse-DNS, never Bubblewrap's host-derived default.                          | The default reverses the origin's host, which puts the app under a namespace the developer does not own and freezes the hosting provider's name into the one string that can never change. (2026-09-19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 17  | The tests land in two batches: shape at steps 2/4, fingerprints and cross-pin at step 12.                            | Between those steps the fingerprint list is empty by design and `android/` does not exist, so the later tests would be red for eight steps — and a test that is expected to be red is a test nobody reads. (2026-09-19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 18  | Plan 2's device rows run on this plan's installs, not in a window of their own.                                      | Plan 2's code landed 2026-08-12, before this plan started. Its only remaining work is observation, and the step 9 and step 12 builds are the first devices that can observe it. (2026-09-19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 19  | Storage shared between the TWA and Chrome is documented, not worked around.                                          | It is how a Chrome TWA works — same profile, same origin, same `localStorage`. A resumed game crossing launchers is the persistence design doing its job; the cost is one line in the tester notes and §8. (2026-09-19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## Open Questions

- [x] Which exact production alias is the binding origin? Needed by step 1, and permanent from step 6.
      **Answered 2026-09-19: `https://playlistjitster.vercel.app`**, chosen by the developer, live,
      serving the manifest, with the old `custom-hitster.vercel.app` redirecting to it. Step 1 has
      the measurements.
- [x] What is the permanent application id string? Reverse-DNS, and genuinely unchangeable after
      first publish. **Answered 2026-09-19: `aleixrabassa.playlistjitster`.** The developer's first
      proposal, `playlist-jitster`, was not a valid application id — Android requires at least two
      dot-separated segments, each starting with a letter and made of letters, digits and underscores
      only, no hyphens — and there is no owned domain to derive from, so the developer's name is the
      namespace. Bubblewrap's own default for this host would have been `app.vercel.playlistjitster`,
      which decision 16 rules out. Step 6 carries the value.
- [x] What happens to the `'Hitster'` label on the first suggested playlist — relabel, or replace
      the suggestion? It is the one player-visible use of the mark (step 13), and it is in the
      screenshots the listing needs. (2026-09-19) **Answered 2026-09-19: RELABEL, to
      `'Jitster official'`, id unchanged** — the developer's choice, executed by
      [`plan.play-store-todo.md`](plan.play-store-todo.md) step 3. Two facts read live from the embed
      payload on the day: the playlist's real Spotify title is **"Hitser"** (one _t_), so the app's
      own label was the only place the mark existed and nothing was being quoted; and its owner
      `arich97` is the developer's own account, which is what entitles the label to say "official".
      `visual-assets/listing.md` §1 carries the record.
- [x] Is moving to a custom domain foreseeable? If it is even plausible within a year, doing it
      _before_ step 6 is far cheaper than after — the origin is baked into the shell. **Answered
      2026-09-19: NO custom domain** (developer's answer;
      [`plan.play-store-todo.md`](plan.play-store-todo.md) decision 4). The shell binds to
      `https://playlistjitster.vercel.app` permanently. The cost is recorded once rather than
      rediscovered: a later domain move is a rebuilt shell, a new asset-links deployment, a second
      install identity for every browser PWA install, and never a redirect from the old origin.
- [ ] Does the content rating questionnaire's user-generated-content question apply? The app renders
      arbitrary track titles from a player-chosen playlist, so it displays text the developer does
      not control.
- [ ] Must Vercel's access-log IP retention be declared in the Data safety form, or does it fall
      under the security-and-fraud exemption?
- [x] Does `bubblewrap update` regenerate the Gradle project from `twa-manifest.json` alone? Resolves
      whether the generated project is tracked or ignored (decision 5). **Answered 2026-09-19: yes,
      completely** — it deletes the generated project and rebuilds it from the manifest plus
      re-fetched icons, so the project is ignored and only `twa-manifest.json` is tracked. Read out of
      the installed CLI rather than run, since `android/` does not exist yet; the file lists and the
      step-8 trap are in `docs/agent_findings.md`.
- [ ] Does the listing name need more distance from the Hitster mark than "Playlist Jitster" already
      provides?
- [ ] Does the PDF export's `doc.save()` download work inside the TWA? Chrome's own download path
      should handle it — unlike the iOS WKWebView case — but it is unverified, and a silently
      missing file is the failure mode. _Widened 2026-09-19: the welcome screen's static
      `<a download>` is a second download path with a different mechanism (a navigation the service
      worker must not answer with `index.html`), and it has the same failure mode. Both are step 9
      rows now._
- [ ] Does the shell hand the launching intent's URL — a shared deck link with its query string — to
      the web app intact, so `App.tsx`'s lazy read of `location.search` deals the deck? Bubblewrap's
      generated activity is built to, but a link that lands on a bare `/` shows the welcome screen
      with no error, which is exactly the shape of failure this app is bad at surfacing. (2026-09-19)

---

## Out of Scope

- **The Android back button.** In `plan.google-play-back-button.md`, deliberately split so this plan
  could reach closed testing without waiting on an application-code change — and in the event built
  first. Its device rows are run here (steps 9 and 12); its open questions about intercepting back
  on the end screen and on the picker (whose on-screen Back button goes to the welcome screen while
  the gesture closes the app) stay with that plan and are not this one's to answer.
- **A persisted "seen the welcome screen" flag.** The front door shows on every cold launch of the
  installed app, by the 2026-09-18 decision. If closed testing reports it as friction, that is a
  product decision to reopen there, not a packaging change.
- **Relabelling or replacing the `'Hitster'` suggestion.** Step 13 surfaces it; the decision is the
  developer's and touches a data list that every landing-screen test renders. _→ **Resolved
  2026-09-19** and no longer out of scope anywhere: relabelled to `'Jitster official'` (id unchanged)
  by [`plan.play-store-todo.md`](plan.play-store-todo.md) step 3, which also added the trademark
  guard over the array. See the Open Question above._
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
