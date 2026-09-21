# Google Play store listing — copy

The text the Play Console listing is filled from, kept here rather than only in the Console so a
future release edits a reviewed, versioned file instead of rewriting it from memory
(`plan.google-play-shell.md`, decision 15). Nothing in this file is shipped by the app: it is
documentation, so it is outside the `src/game/copy.ts` rule — but **it must not contradict
`COPY.*`**. Where a line below describes a screen, it was checked against the real string in
`src/game/copy.ts` on 2026-09-21 (re-verified: every claim in §3's source table, plus the
Alternate B tagline quote in §2, which had drifted from the live string).

**Status: step 13 is NOT done.** This file is the copy half only — the graphics, the screenshots and
the Console itself are still outstanding. **The trademark question that used to block it is
RESOLVED (2026-09-19)** and the picker is no longer off-limits to a screenshot; see §1.

**How the character counts below were produced.** Each description sits in a fenced block, and the
count is of that block's exact contents, newlines included, counted as Unicode code points —
`node -e "console.log([...require('fs').readFileSync(0,'utf8')].length)"`. Code points, not bytes:
an em dash is one character to Play and three bytes to `wc -c`. Recount after any edit; do not
hand-count, and do not trust a count that was not re-run.

---

## 1. TRADEMARK RULE

**No listing copy, no screenshot caption, no graphic and no store metadata may contain the word
"Hitster".** It is a registered board-game mark, Play acts on IP complaints, and a listing is the
most visible surface this project has. This is a rule, not a preference: a string that reaches the
Console carrying it is a defect to fix before upload, whatever it was quoting.

**The internal uses of the word stay, and renaming them is the mistake.** The board-game reasoning
behind the card geometry in `src/game/pdf-sheet.ts` (which since 2026-09-21 explains why the 65 mm
shop-bought size was DROPPED), the dropped-card reasoning in `src/game/reducer.ts` and
`src/game/messages.ts`, `src/components/CardRevealSide.tsx`, the `hitster:session:v1` and
`hitster:library:v1` storage keys, `useBackNavigation.ts`'s `customHitsterBackEntry` history-state
key, and the `custom-hitster` package/repo name. Every one of those is either a comment explaining
the board game the rules come from, or an identifier no player reads — and renaming a storage key
silently discards a player's saved game and their whole saved-playlist library. Verified
2026-09-19 over `src/` **and `index.html`** (which is shipped bytes on the critical path and
carries the `<title>` and `<meta description>` a crawler reads — it is clean): every hit except the
one below is a comment or an identifier, never a rendered string.

### The audit's one hit — RESOLVED 2026-09-19 by relabelling

`SUGGESTED_PLAYLISTS[0]` in `src/components/LandingScreen.tsx` read
`{ id: '34cIJlWIX9TEoA8bpI2UBu', label: 'Hitster', blurb: 'Mixed hits' }`, and it is now
`{ id: '34cIJlWIX9TEoA8bpI2UBu', label: 'Jitster official', blurb: 'Mixed hits' }`. **The id did not
change** — the same playlist, a different label.

What it is: an entry in a `readonly` data array of ready-to-try playlists, rendered as the visible
text of a `SuggestionButton` in the "Or try one of these" grid on the playlist picker. It was a
readable rendering of that Spotify playlist's own title — the file's own header says the labels are
renderings rather than quotations, which is what made relabelling permitted rather than a
falsification. It is **not** in `src/game/copy.ts`, because it is data about a third-party playlist
rather than a sentence the app says.

Why it mattered: it is a button in front of every player, on the screen every player passes through,
and therefore in **any screenshot of the picker**.

**The decision (`plan.play-store-todo.md` decision 5): relabel, do not replace.** Replacing the
playlist would have thrown away a verified, hand-picked mixed-hits deck to solve a naming problem.
Two facts recorded on the day it was taken, both read live from the embed payload by `entity.uri`
**and** `entity.name` as the array's own rule 1 requires:

- The playlist's **real Spotify title is "Hitser"** — one _t_, a typo in the source. So the app's own
  label was the only place the registered mark ever existed; nothing was being quoted.
- Its **owner is `arich97`** (`entity.subtitle`; `authors` is `null` at playlist level, as the embed
  payload always has been), **confirmed by the developer as their own account** — which is what makes
  the word "official" a claim this project is entitled to make.

Consequences, now that it is decided:

- **Screenshots of the picker are unblocked** as soon as the relabel is deployed. The welcome screen
  was never blocked — nothing in `COPY.welcome` uses the word.
- The listing text below never used the word and needed no revision.
- `src/components/LandingScreen.test.tsx` carries a guard asserting the mark appears in no `label`
  and no `blurb` of any row, case-insensitively, so a future addition to the array cannot reintroduce
  it silently. The relabel itself is invisible to the rest of the suite by design: eleven existing
  sites read `SUGGESTED_PLAYLISTS[0]!.label` symbolically and no test holds the literal.

### Two more places the word appears, neither of them listing copy

- **`README.md` links to the board game by name** ("a playable digital [Hitster](…) deck"). Its second
  use — printed cards "sized to match shop-bought Hitster cards" — went with the 2026-09-21 card
  geometry, which dropped the 65 mm size. The remaining link is fine for a repository — it
  is describing what the project is modelled on, to developers — and it is **not** fine in anything
  pasted into the Console. Do not copy a sentence from the README into the listing.
- **`public/privacy.html` names the two storage keys**, so the word appears on the page the
  listing's privacy-policy URL points at. It is a technical identifier in a policy document, not
  marketing copy, and renaming the keys would discard saved games. Left as is, recorded here so it
  is a decision rather than an oversight.
- **`public/robots.txt`'s first line is a comment beginning "Custom Hitster is a single public
  page…"** — served at `<origin>/robots.txt`, so publicly fetchable, though it is a developer
  comment in a crawler directive rather than anything a player or a reviewer is shown. Noted for
  completeness; not listing copy, and not changed here.

### Still open, and not answered here

Whether the listing name "Playlist Jitster" itself needs more distance from the mark
(`plan.google-play-shell.md`, Open Questions). Recorded, not resolved.

---

## 2. Short description — 80 character limit

### Recommended — 75 characters

```text
Turn any Spotify playlist into a card game: guess each song's release year.
```

### Alternate A — 80 characters (exactly at the limit; no room for an edit)

```text
Paste a Spotify playlist, deal a deck of cards, and guess the year of each song.
```

### Alternate B — 61 characters

```text
The music timeline game, now from your own Spotify playlists.
```

Alternate B is `COPY.welcome.tagline` character for character — the one line a player reads first —
so it is worth preferring if the listing and the app should say the same thing on arrival. The recommendation is the first because it names
the verb ("guess the year") that the tagline leaves implicit, and the store's short description is
read next to twenty others.

---

## 3. Full description — 4000 character limit

**2194 characters** of the 4000 allowed (recounted 2026-09-21, after the 49 mm / 16-per-sheet edit).

```text
Playlist Jitster turns any public Spotify playlist into a music timeline card game.

Paste a link — or pick one of the suggestions — and the tracks are shuffled into a deck. Each card shows nothing but a QR code. Scan it to open the full song in Spotify, or press Play to hear a preview in the app. Say what year you think it came out, then tap the card to flip it and see the title, the artist and the answer. Swipe right to deal the next card, or left to go back one.

HOW A ROUND GOES
1. Pick your playlists. Up to five public Spotify playlist links at once, shuffled into one deck.
2. Play the card. Scan the QR code for the full song, or press Play for a preview.
3. Guess the year, then flip the card to check.

THE YEAR IS THE POINT, SO IT IS LOOKED UP PROPERLY
Spotify reports the date of the album edition you happen to be listening to, which turns a 2011 remaster into a 2011 song. Playlist Jitster asks MusicBrainz for the original release year instead, and marks a year it is unsure about rather than pretending. A song it cannot place at all is left out of the deck.

PLAY ON PAPER TOO
• A printable PDF of year cards, 1970 to 2033, ready before you have chosen a playlist. Print them, cut them out, and lay the timeline along the table.
• Any deck can be exported as printable cards: 49 mm squares, 16 to an A4 sheet, QR codes on the fronts and years on the backs — the same size as the printable year cards. Print double-sided on the long edge.

SHARE A DECK, OR KEEP IT
Copy a share link and whoever opens it gets the same playlist in the same shuffled order — the years are looked up again, so the deck can differ slightly. Keep the playlists you like in your own list on the start screen, one tap from dealing them again.

ONCE IT IS LOADED, IT KEEPS PLAYING OFFLINE
A game you have already started resumes and stays playable with no connection. Song previews, years still being looked up, and dealing a brand new deck are the parts that need one.

NO ACCOUNTS, NO ADS, NO ANALYTICS
Nothing to sign up for. Your game and your saved playlists stay in your own device's storage. No advertising, no analytics, no third-party tracking.

Not affiliated with Spotify or MusicBrainz.
```

**Where each claim came from, so a reworded app can be checked against it:**

| Claim in the copy                          | Source                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Up to five playlists                       | `MAX_DECK_PLAYLISTS = 5` in `src/game/deck-merge.ts`, rendered by `COPY.welcome.steps.pick` |
| Scan for the full song, Play for a preview | `COPY.welcome.steps.play.body` and `COPY.game.scanCaption` — the QR is the **full song**    |
| Tap to flip, swipe right/left              | `COPY.welcome.steps.guess.body`                                                             |
| "the years are looked up again…"           | `COPY.deckActions.shareCaption` — never promises the same deck                              |
| 49 mm squares, 16 per A4, long-edge duplex | `COPY.deckActions.sheetSummary` and `src/game/pdf-sheet.ts` (`CARD_SIZE_MM` = 48.9722)      |
| Year cards 1970–2033                       | `COPY.welcome.printDetail` + `public/year-cards-1970-2033.pdf`                              |
| Offline behaviour                          | `README.md` "Install it on your phone"; `runtimeCaching` is empty on purpose                |
| No accounts / ads / analytics              | `public/privacy.html`                                                                       |

Two things the copy deliberately does **not** say: that the app works offline without qualification
(only a started game does — dealing a deck needs a connection), and that the years are always
right (they are not; see `README.md`'s known limitations). The "Not affiliated" line is a
recommendation rather than a requirement: Play acts on implied affiliation, the app reads Spotify's
public embed endpoint anonymously and is not a Spotify product, and one sentence is cheap.

---

## 4. Assets — all outstanding, all manual

Nothing here can be produced or checked by a command in this repo. **No check in this repo has ever
opened an image**, so every item below ends with somebody looking at the result.

- [ ] **Feature graphic, 1024×500.** Must be **composed**, not cropped: the master is square. Build
      it from **`docs/assets/logo.png`** (1254×1254, the 2026-08-12 artwork, wordmark reading
      "PLAYLIST JITSTER") and **never from anything in `public/`** — everything in `public/` ships
      and is precached by the service worker, which is exactly why the 1.2 MB master is kept out of
      it. Raise the graphic's black floor to `--color-page` (#0a0a0a) as every other derivative
      does: the artwork's backdrop is pure black, the page is not, and a 4% luminance step across a
      straight edge reads as a pasted square.
- [ ] **At least two phone screenshots, the welcome screen first.** A cold launch shows the welcome
      screen every time — `start_url` is `/`, and since 2026-09-18 that is the front door on every
      launch, by a recorded decision with no "seen it" flag and none planned. A first screenshot of
      anything else would show a screen no new install opens on. Manual because it needs the app
      running on a device or an emulator at a real phone resolution.
- [ ] **Second and later screenshots: pick from the game screen, the reveal and the end screen.**
      Note the picker is currently unusable for a screenshot — see the trademark rule above.
- [ ] **Check `public/pwa-512x512.png` against Play's current icon spec** (read the Console's own
      requirements on the day rather than from memory). Use the `purpose: 'any'` file, **not**
      `pwa-maskable-512x512.png` — that one is a separate file whose artwork is drawn at **72% of
      the canvas** with the rest as background, so a launcher can crop it to any shape; as a store
      icon it would read as a small mark floating in a large field.
- [ ] **Open the 512 and look at it.** It DOES carry a wordmark. `plan.google-play-shell.md` as
      written on 2026-08-11 claimed the icons carried none; its 2026-09-19 review note already
      records the correction, and this file repeats it because the listing is where the icon
      actually gets uploaded. The icons read "PLAYLIST HITSTER" until the 2026-08-12 artwork
      replaced them and nobody had opened the image — since then every icon is a LANCZOS downscale
      of `docs/assets/logo.png` reading "PLAYLIST JITSTER", so the artwork agrees with the listing
      name by regeneration, which is a thing to confirm by eye rather than assume.

---

## 5. Category and declarations

From `plan.google-play-shell.md` steps 10 and 14.

| Field              | Value                                                             |
| ------------------ | ----------------------------------------------------------------- |
| App name           | Playlist Jitster                                                  |
| Default language   | English (`manifest.lang` is `en`, `dir` is `ltr`)                 |
| Category           | Games, with a music/trivia subcategory                            |
| Price              | **Paid — €1.00, one-time** (changed 2026-09-21; see below)        |
| Ads                | None                                                              |
| Target audience    | Not primarily child-directed, to stay outside the Families policy |
| Privacy policy URL | `https://playlistjitster.vercel.app/privacy.html`                 |

**The app is PAID as of 2026-09-21, and the ORDER of that decision is the part that matters.** Google
allows paid → free and **refuses free → paid**: an app that has ever been offered free can only be
charged for by creating a new app **with a new package name**, which would throw away
`aleixrabassa.playlistjitster` and every permanent identity built on it. So choosing paid now is the
reversible direction and choosing free would have been the one-way door. Read from
`support.google.com/googleplay/android-developer/answer/6334373`, 2026-09-21.

Three things that follow, none of them about the number. **A payments profile is a PREREQUISITE** —
Google's own steps are "set up a payments profile, review the price ranges, then enter a price" — and
it is a merchant account with bank and tax details and its own verification cycle, so it is a calendar
wait of the same kind as identity verification and wants starting immediately. **The €1.00 must be
checked against Play's price-range list for EUR** rather than assumed; the minimum was not sourced here
and is deliberately not guessed. And **what €1.00 nets is not €1.00**: Play's service fee applies, and
whether Google is the merchant of record for Spanish VAT — which decides whether the €1 is
VAT-inclusive — was **not verified** and should be read off the payments profile rather than from this
file.

The privacy policy URL is `<origin>/privacy.html`, and the origin is the one pinned by step 1:
`https://playlistjitster.vercel.app`. The file is `public/privacy.html`, static, reaching the
browser unrewritten because `vercel.json`'s SPA rewrite source excludes any path containing a dot.

### Data safety form

The honest position is close to "no data collected", but it is **not** "nothing leaves the device",
and the form must account for:

- the **playlist id** leaving the device, sent to this app's own function to read the public Spotify
  embed;
- the **track title, artist and duration** leaving the device, sent to the year function;
- the **Upstash cache**, which is server-side storage of those strings with a TTL — server-side
  storage is the part that is easy to answer "no" to by accident;
- **Spotify receiving the player's IP address**, because preview audio and the embed are fetched by
  the browser directly rather than proxied;
- MusicBrainz being contacted **server-side**, so it does not see the player at all.

**Fill the form from `public/privacy.html`, which is the enumeration** — it was written from the
source in this same session and is the reviewed list. Do not re-derive it from memory. Still open in
the plan: whether Vercel's access-log IP retention must be declared, or falls under the
security-and-fraud exemption.

### Content rating questionnaire

The **user-generated-content question needs thought before it is answered**. The app renders
arbitrary track titles and artist names from a playlist the player chooses, so it displays text the
developer neither wrote nor controls — while having no accounts, no submission, no sharing between
users and no moderation surface. It is not obviously a "yes" and not obviously a "no", and answering
it carelessly is how a rating gets re-issued. The plan carries it as an Open Question.
