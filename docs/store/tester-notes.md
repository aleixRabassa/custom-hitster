# Playlist Jitster — notes for closed-track testers

Thank you for testing. This page is everything you need to install the app, plus the short list of
things that look like bugs and are not — so you can spend your time on the things that really are.

It is written for people who did not build the app, so there is no jargon in it. If something here
is unclear, that is worth reporting too.

---

## What the app is

A music guessing game. You pick a Spotify playlist, the app deals you a card for each song, and you
place it in order by the year the song came out. The card shows a QR code you can scan to play the
full song in Spotify, and a short preview plays in the app itself.

You do **not** need a Spotify account, and the app has no accounts, no ads and no sign-in of any
kind.

---

## How to join the test

1. Open the invitation link you were sent, on the phone you will test with, and accept it.
2. Follow the link on that page to Google Play.
3. Install **Playlist Jitster** as you would any other app.

> **Note for whoever sends the invitations — not for testers, and to be replaced before this file is
> shared.** The app became **paid (€1.00)** on 2026-09-21, and step 3 above is written as if it were
> free. Testers must not be asked to pay to test. Settle the mechanism that waives it (Play's license
> testing is the candidate) at the plan's step 16, then rewrite step 3 and delete this note. Leaving
> it as it stands sends twelve people to a price they were not warned about.

If Play says the app is not available, give it a few hours: a new test build takes a while to reach
every account, and there is nothing to fix at your end.

**Any Android phone is welcome.** If yours runs Android 13 or newer, so much the better — the newer
back gesture only exists there — but nothing in the list below needs it.

**Please stay in the test.** Leaving it early, even after you have finished testing, sets the
release back by days — Google counts continuous days with testers enrolled, not days of testing.

---

## Things that are expected — please do not report these

**The welcome screen appears every single time you open the app.** Not just the first time. The app
deliberately does not remember that you have seen it; there is one big button to get past it. If you
find this annoying, say so — that is useful feedback, and different from a bug report.

**A game you played in your phone's browser shows up in the app, and the other way round.** If you
have ever opened the game at `playlistjitster.vercel.app` in Chrome on the same phone, the installed
app will offer to continue that game, and any playlists you saved there will be in the app's list.
This is on purpose: the app and the browser share one save. So "it remembered a game I never played
in it" is the app working correctly.

**Songs whose release year cannot be found are dropped from the deck.** A playlist of 50 songs
regularly deals fewer than 50 cards. The app tells you when it happens.

**A card's preview is about 30 seconds and some songs have no preview at all.** That comes from
Spotify, not from us. Scanning the QR code plays the full song.

**The app needs an internet connection to start a new game.** A game already in progress keeps
working offline, minus the audio and minus looking up new years.

**Pressing back during a game makes the app look like it is closing, and then it does not.** You may
see the screen shrink away as if you were going to the home screen, before the "leave the game?"
question appears instead. Nothing is going wrong: that shrinking is Android previewing where the
back gesture would normally take you, and the game is catching the press to ask you first. Your deck
is not lost. We know about it and have chosen to leave it as it is. Tell us if it bothers you enough
to change that — but it is not a bug report.

---

## Things that are NOT expected — please do report these

**A web address bar across the top of the screen.** The app should fill the screen with no browser
bar of any kind. If you see one — even once, even briefly — that is the single most important thing
to report. Please include a screenshot.

**The app closing without asking, when you press Back or swipe back during a game.** During a game,
back should bring up a "leave this game?" question, not close the app. Outside a game (on the
welcome screen, the playlist picker, or the end screen), back closing the app is correct.

**Music still playing after you lock the phone.** The sound should stop when the screen goes off.
When you unlock, it stays stopped on purpose — pressing Play should then continue from where it
stopped rather than starting the song again. Silence after unlocking is correct; a song that
restarts from the beginning is not.

**A download that does not arrive.** There are two: a "printable year cards" link on the welcome
screen, and a "Print as PDF cards" button during a game. Both should put a PDF in your Downloads.
A file that silently never appears is a real bug and it is easy to miss — please check Downloads
rather than assuming it worked.

**Tapping a shared game link opens the browser instead of the app.** If someone sends you a link to
a deck and you tap it, the installed app should open and deal that deck straight away.

**Anything that looks wrong on your screen size** — text cut off, a card that does not fit, buttons
you cannot reach, a QR code that will not scan.

And of course: crashes, freezes, a card that never loads, or anything that simply does not do what
you expected.

---

## How to report something

Send it to the address in the invitation email, or reply to it. Please include:

- **What you did**, step by step, so we can try it ourselves.
- **What happened**, and what you expected instead.
- **A screenshot or a short screen recording** if there is anything to see.
- **Your phone model and Android version** (Settings → About phone).
- **Roughly when it happened** — the date and time are enough.

One report per problem is easier to act on than a list. There is no such thing as a report that is
too small.

---

## Your privacy while testing

The app collects nothing about you. It has no analytics, no advertising and no accounts. What leaves
your phone is the song information needed to look up release years, and — only once you press Play —
a request to Spotify for the preview audio. The full policy is at
<https://playlistjitster.vercel.app/privacy.html>.

Google Play shows us which testers have joined, as it does for every test. It does not show us
anything about how you play.
