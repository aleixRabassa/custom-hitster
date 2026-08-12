/**
 * The card's host: one `<audio>` element for the whole session, the notice slot, the HUD, the
 * stacked deck, the control bar, and the keyboard controls.
 *
 * It is the integration seam of Phases 4-5 and stays PRESENTATIONAL: every callback arrives as
 * a prop and nothing here calls `useGameSession()`. Plan 3 builds the container that does, and
 * adds the HUD and the notices to this file.
 *
 * ## The audio element lives here, not in the card
 *
 * `useCardAudio` explains the reasoning in full; the short version is that a single element
 * makes "a track never bleeds into the next card and never doubles up" structurally
 * impossible rather than a rule to enforce. `CardStack` renders 3 cards at once, which is
 * exactly the window where per-card elements would overlap and play together.
 *
 * ## ONE stop rule, and the second one was DELETED on purpose (2026-08-06)
 *
 * Audio stops when the CARD CHANGES, and that is the only rule. It is also what covers a
 * SWIPE, which is why `useCardGestures` does not stop audio itself: one owner of the stop
 * rule, not two.
 *
 * ===========================================================================
 *  THERE USED TO BE A STOP-ON-FLIP EFFECT HERE. DO NOT PUT IT BACK.
 *
 *  "Surely the preview should stop once the answer is showing" is Phase 4's own
 *  reasoning, it is the obvious thing to re-add, and playing the game disagrees
 *  with it: HEARING THE SONG WHILE READING THE YEAR IS THE POINT OF THE REVEAL.
 *  A flip that killed the music turned the payoff into silence.
 *
 *  The rule's second justification -- that a lingering preview would bleed into
 *  the next card -- is already covered in full by the card-change rule below,
 *  which keys on card id and fires before the new src is loaded. So the effect
 *  was deleted and NOTHING replaced it; no behaviour moved anywhere else.
 *
 *  `CardControls` lives outside the card, so Play/Pause stays reachable while the
 *  reveal is on screen and a player who does want silence has a button for it.
 *
 *  Reversal of a completed phase, so it is written down in `plan.md` §5,
 *  `AGENTS.md`'s dated-decisions block and `docs/agent_findings.md` as well as
 *  here, and `GameScreen.test.tsx` asserts the NON-stop.
 * ===========================================================================
 *
 * There is a THIRD pause rule and it deliberately does not live here: `useCardAudio` pauses when
 * `document.hidden` becomes true -- a locked phone, a switched app, a switched tab. It belongs to
 * the hook rather than to this screen because it is a property of the DOCUMENT rather than of the
 * card: no card changed, and the session is exactly where the player left it. Found on a real
 * device on 2026-08-06, when a locked phone went on playing the preview.
 *
 * ## Exit goes through a confirmation, and this file owns whether it is showing
 *
 * `CardControls`' Exit button now REQUESTS an exit; `ExitConfirmDialog` asks; only a confirmed
 * press calls `onExit`. The open flag is the one piece of state this screen holds that is not about
 * audio, and it belongs here rather than in the container for the same reason the flip's stop rule
 * does: it is a property of this screen being on screen. It also gates the key handler below, which
 * is the non-obvious half -- see guard 4.
 *
 * ## The platform back press is an in-app control, and MOUNTING THIS SCREEN IS THE SCOPING
 *
 * `useBackNavigation` pushes one history entry while this component is on screen and turns a back
 * press into the same exit REQUEST the Exit button makes -- or, with a dialog up, into closing that
 * dialog. Do not go looking for a `status === 'playing'` check anywhere: this screen is rendered
 * exactly while the status is `playing`, so the interception's lifetime is the mount's, and every
 * other screen keeps Android's default behaviour by construction rather than by an exclusion list.
 *
 * It exists because a TWA has no history entry to go back to, so the gesture closed the activity
 * outright -- bypassing the confirmation invisibly, since the session survives in `localStorage` and
 * a relaunch resumes. The two files carry the reasoning; nothing about it lives here.
 *
 * ## The deck actions are reachable mid-game as of 2026-08-06
 *
 * `CardControls` has a fourth button that opens `DeckActionsDialog` -- the share link, the save and
 * the PDF export, the same `DeckActions` the end screen renders. It reverses half of plan 2's
 * decision 7, which had put them on the end screen and nowhere else; the reason it reversed is that
 * REACHING the end screen means ending the game, and ending the game is irreversible, so copying a
 * link cost the player their deck. Both of that decision's objections are answered rather than
 * dropped -- `DeckActions` for the spoiler half, the dialog's backdrop plus guard 4 below for the
 * swipe half. Nothing interactive was added inside `Card`.
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { CardControls } from './CardControls';
import { CardStack } from './CardStack';
import { DeckActionsDialog } from './DeckActionsDialog';
import { ExitConfirmDialog } from './ExitConfirmDialog';
import { Footer } from './Footer';
import { Hud } from './Hud';
import { COPY } from '../game/copy';
import { useBackNavigation } from '../hooks/useBackNavigation';
import { useCardAudio } from '../hooks/useCardAudio';
import type { Card as CardData } from '../../shared/types';

/** `KeyboardEvent.key` for the flip. A literal because `'Space'` is the *code*, not the key. */
const FLIP_KEY = ' ';

/** `KeyboardEvent.key` for advancing. `ArrowLeft` is deliberately unhandled -- see below. */
const NEXT_KEY = 'ArrowRight';

export interface GameScreenProps {
  /** The shuffled deck, straight from `GameState.deck`. */
  deck: CardData[];
  /** Index of the current card, straight from `GameState.currentIndex`. */
  currentIndex: number;
  isFlipped: boolean;
  /** True only for `year === undefined` — from `isCurrentYearPending`. */
  isYearPending: boolean;
  onFlip: () => void;
  onNext: () => void;
  onExit: () => void;
  /**
   * Whether the session can actually be played right now -- `status === 'playing'`.
   *
   * Gates both the gestures and the key handler. The container owns the answer; deriving it
   * here would mean this component knowing about `GameStatus`, which is exactly the session
   * knowledge it is supposed not to have.
   */
  isPlayable: boolean;
  /** Cards still to come after the current one, from `cardsRemaining`. Straight to the HUD. */
  cardsRemaining: number;
  /**
   * The deck's label, from `deckLabel(state.playlists)`. Playlist-level only — never track data.
   *
   * A SINGLE STRING even though a deck is now 1..5 playlists (decision 8). The label is that
   * string, the HUD already truncates a long one, and pushing the array down here would turn a
   * truncation rule into a layout decision for no gain.
   */
  playlistName: string;
  /**
   * The deck's 1..5 Spotify playlist ids, from `state.playlists`. One half of the share link.
   *
   * These five are the deck-actions props, straight through to `DeckActionsDialog` and used for
   * nothing else here. They are playlist-level and seed-level -- not one of them derives from a
   * card, which is what keeps this screen's leak story unchanged by the whole feature.
   */
  playlistIds: readonly string[];
  /** The seed this deck was dealt with, from `state.seed`. The other half of the link. */
  seed: string;
  /** Where a shared link should point -- `origin + pathname`, supplied by the container. */
  shareOrigin: string;
  /** Save this playlist to the landing screen's library. */
  onSavePlaylist: () => void;
  /** True once this playlist is in the library. Turns the save button into its own confirmation. */
  isPlaylistSaved: boolean;
  /**
   * Lookups still in flight, from `pendingYearCount`. The PDF export waits for it to reach zero.
   *
   * Mid-game this is the NORMAL case rather than an edge one -- the crawl runs for the whole
   * session at one lookup a second -- which is exactly why the wait exists.
   */
  pendingYearCount: number;
  /**
   * The notice banner, or null.
   *
   * Passed in as a NODE rather than as three booleans, because dismissal is container state
   * (decision 9): the banner has to survive a card change and disappear for good when dismissed,
   * and neither is something this component should be tracking. It renders whatever it is given
   * above the HUD and has no opinion about the contents.
   */
  notice?: ReactNode;
}

/**
 * Is focus somewhere that owns its own keystrokes?
 *
 * Plan 3 puts a playlist-URL input on the landing screen, and this handler must not eat its
 * spaces. `isContentEditable` is checked as well as the tag names because a rich-text host is
 * a `div` as far as `tagName` is concerned.
 */
function isTextEntryElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;

  return (
    element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT'
  );
}

export function GameScreen({
  deck,
  currentIndex,
  isFlipped,
  isYearPending,
  onFlip,
  onNext,
  onExit,
  isPlayable,
  cardsRemaining,
  playlistName,
  playlistIds,
  seed,
  shareOrigin,
  onSavePlaylist,
  isPlaylistSaved,
  pendingYearCount,
  notice,
}: GameScreenProps) {
  const currentCard = deck[currentIndex];
  const audio = useCardAudio(currentCard?.previewUrl);
  const { audioRef, stop } = audio;

  /**
   * Whether the exit confirmation is showing. SCREEN state, and it stays here.
   *
   * Not session state and not the container's: the reducer has no `CONFIRM_EXIT` action and should
   * not gain one -- nothing about the game changes while the question is on screen. The container
   * hears about it only if the player answers yes, at which point it gets the same `onExit()` call
   * it always got.
   */
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);

  /**
   * Whether the deck-actions panel is showing. Screen state for the same reason the flag above is:
   * nothing about the game changes while it is open, and the reducer has no action for it.
   *
   * It gates the key handler exactly as the exit flag does -- see guard 4. That gate is what makes
   * a modal panel a safe answer to plan 2's "interaction conflict with the swipe" objection: while
   * this is open the screen has no keyboard interface and its backdrop has the pointer.
   */
  const [isDeckActionsOpen, setIsDeckActionsOpen] = useState(false);

  /**
   * Stop on card change. The only stop rule -- see the header block for the one that was deleted.
   *
   * Belt and braces with `useCardAudio`'s own src-swap effect, and deliberately so: that
   * effect keys on `previewUrl`, and two different cards can share one (a duplicated track in
   * the deck -- which Phase 3 handles explicitly because playlists really do that). Keying on
   * the ID here is what covers that case, and it is also what makes a swipe stop the audio
   * without `useCardGestures` having to know about audio at all.
   */
  const cardId = currentCard?.id;
  useEffect(() => {
    stop();
  }, [cardId, stop]);

  /**
   * Keyboard controls: Space flips, → advances.
   *
   * ===================================================================
   *  A WINDOW-LEVEL HANDLER, NOT A HANDLER ON A FOCUSED ELEMENT.
   *
   *  The card is not a control and nobody's hands are on it -- a player
   *  on a laptop is sitting back. A handler bound to a focusable card
   *  would be dead for as long as focus was anywhere else, which is most
   *  of the time, and "the keyboard works only after you click the card
   *  first" is indistinguishable from broken.
   *
   *  The cost of window level is that this handler sees keystrokes meant
   *  for other things, hence the three guards below. Each one is a real
   *  bug, not defensive padding:
   *
   *  1. AUTO-REPEAT. Leaning on → deals the entire deck, and the deck is
   *     one-directional -- there is no way back from that.
   *  2. TEXT ENTRY. Plan 3's landing input would lose every space to the
   *     flip handler, so typing a playlist URL would silently flip cards.
   *  3. SPACE ON A FOCUSED BUTTON. The subtle one, and invisible until
   *     someone plays with a keyboard after clicking Play: Space is how a
   *     button is activated, so one press would BOTH toggle audio and
   *     flip the card -- revealing the answer as a side effect of
   *     pressing play.
   *  4. EITHER MODAL. Not a guard inside the handler but the effect's
   *     own condition, below: while a dialog is open the card is behind a
   *     backdrop, and a → that dealt the next card under it would mean
   *     answering a modal and losing a card in the same keystroke.
   *     Guard 3 covers Space (focus is on a dialog button) but nothing
   *     covers → , and Escape belongs to the dialog alone. It covers BOTH
   *     dialogs -- the exit confirmation and the deck-actions panel -- and
   *     a third one added later must be added to this condition too.
   * ===================================================================
   */
  useEffect(() => {
    if (!isPlayable || isExitConfirmOpen || isDeckActionsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Guard 1. Held keys.
      if (event.repeat) return;

      const active = document.activeElement;

      // Guard 2. Applies to both keys: an input is entitled to every keystroke it gets.
      if (isTextEntryElement(active)) return;

      if (event.key === FLIP_KEY) {
        // Guard 3. Space only -- ArrowRight does nothing to a focused button, so there is no
        // double-action to avoid there. Focus is deliberately NOT stolen from the button
        // after a click: silently moving a keyboard user's focus is a worse bug than the one
        // it would paper over, and this guard already closes it.
        if (active instanceof HTMLButtonElement) return;

        // Space scrolls the page by default, and the card is viewport-sized.
        event.preventDefault();
        onFlip();
        return;
      }

      if (event.key === NEXT_KEY) {
        onNext();
      }

      // ArrowLeft is intentionally unhandled. There is no previous card -- the deck is
      // one-directional by design -- so the safe response to a player pressing it is nothing
      // at all.
      //
      // A "no going back" hint was pencilled in as a Phase 7 call and NEITHER Phase 7 plan
      // took it up: plan 1 is tokens, layout and a11y, plan 2 is error and offline states.
      // So it is unowned rather than pending, and it stays unowned until somebody decides a
      // silent ArrowLeft is actually a problem.
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlayable, isExitConfirmOpen, isDeckActionsOpen, onFlip, onNext]);

  /**
   * The Exit button ASKS. It no longer ends the game.
   *
   * Exit is irreversible -- `END` clears the saved session, so the shuffle, the position in the
   * deck and every resolved year go with it, and nothing in the app can bring them back. The
   * button is a 44px round target two positions from Play, on the surface a thumb swipes. Audio is
   * deliberately left running: the player may well say no, and stopping the preview for a question
   * they cancel is a change they did not ask for.
   */
  const handleExitRequest = () => {
    setIsExitConfirmOpen(true);
  };

  const handleExitConfirmed = () => {
    // Stop BEFORE handing control away: `onExit` unmounts this screen, and a pending play() on a
    // disappearing element is how a stray sound outlives its card.
    stop();
    onExit();
  };

  const handleExitCancelled = () => {
    setIsExitConfirmOpen(false);
  };

  /**
   * The platform back press, routed through the SAME handlers the on-screen controls use.
   *
   * `handleExitRequest`, not `handleExitConfirmed` -- back asks exactly as the Exit button asks,
   * so there is one confirmation rather than two paths to the same irreversible action. It is
   * called here, below the handlers, because that is where they exist; the hook itself attaches
   * its listener once and reads whatever the latest render passed.
   *
   * GUARD 4 NEEDS NO CHANGE, and that was verified rather than assumed: it gates the window key
   * handler on the two dialog flags, and this adds no third dialog -- back either closes one of
   * those two or opens the exit confirmation, so the OR above still covers everything that puts a
   * backdrop over the card.
   */
  useBackNavigation({
    isDeckActionsOpen,
    isExitConfirmOpen,
    onCloseDeckActions: () => {
      setIsDeckActionsOpen(false);
    },
    onCloseExitConfirm: handleExitCancelled,
    onRequestExit: handleExitRequest,
  });

  return (
    /*
      ===========================================================================
       `relative pb-20` IS `Footer`'S CONTRACT, AND THIS SCREEN PAYS FOR IT OUT OF
       THE CARD'S HEIGHT BUDGET (2026-08-12).

       The copyright line is now on every screen, mid-game included, at the
       developer's request. `Footer` is `absolute bottom-8`, so it takes no row in
       this column -- but the 80px band it needs is 56px more than the `p-6` this
       screen used to have, and this column is a height budget rather than a page:
       `--card-height` is `clamp(15rem, min(62dvh, 80vw), 24rem)` so that the HUD,
       the notice, the card, its caption and the control bar fit a phone without
       scrolling. On a short viewport that 56px is what makes the column overflow.

       ACCEPTED, not overlooked -- and the lever if it hurts on a real device is
       `--card-height`'s `62dvh` term in `src/index.css`, not deleting the footer
       from this one screen. `Footer.tsx` records the same trade from its side.
      ===========================================================================
    */
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-6 bg-page p-6 pb-20">
      {/*
        THE session audio element. `preload="none"` so nothing is fetched until the player
        actually asks -- a 100-card deck must not pull 100 previews for cards nobody reaches.
        No `controls` attribute: `CardControls` is the interface, and the native control bar
        would show a seek position the game has no reason to expose.
      */}
      <audio ref={audioRef} preload="none" data-testid="session-audio" />

      {/*
        Above the card rather than below it. A notice is read once and then ignored, so it belongs
        out of the thumb's way -- the bottom of a phone screen is where the card and its controls
        are, and a banner there would be dismissed by accident mid-swipe.
      */}
      {notice}

      <Hud cardsRemaining={cardsRemaining} playlistName={playlistName} />

      {/*
        ===========================================================================
         THE CARD AND ITS CAPTION ARE ONE GROUP, AND THE CAPTION USED TO BE ON THE
         CARD'S FACE (moved out 2026-08-11, at the developer's request).

         `gap-3` inside the group against the column's `gap-6` outside it is the
         whole reason for the wrapper: the sentence has to read as belonging to the
         card rather than as a third row between the card and its controls. Removing
         the wrapper does not break anything, it just makes the caption float.

         IT IS RENDERED UNCONDITIONALLY, INCLUDING WHILE THE CARD IS FLIPPED, and
         both halves of that are deliberate. On the face it disappeared on a flip
         for free -- the face rotated away -- and reproducing that with
         `{isFlipped ? null : ...}` would REMOVE A LINE FROM A CENTRED COLUMN, so
         the card itself would jump every time the player flipped it. Leaving it up
         is also honest: the flip is a toggle, so the QR is one tap away.

         NOT `aria-hidden`, and not duplicated either. The QR's own `alt` is "Scan
         to play in Spotify", which says the same thing to a screen reader -- but
         this line is 12px of visible instruction on the game's main surface, and
         hiding it from assistive technology to avoid a near-duplicate would be
         choosing which sighted-only detail to keep. `CardStack`'s BACK is the place
         that must not repeat it, and it does not: the caption is no longer inside
         `CardHiddenSide` at all, which is what stopped the sentence being in the
         document twice per card.
        ===========================================================================
      */}
      <div className="flex flex-col items-center gap-3">
        <CardStack
          deck={deck}
          currentIndex={currentIndex}
          isFlipped={isFlipped}
          isYearPending={isYearPending}
          onFlip={onFlip}
          onNext={onNext}
          isEnabled={isPlayable}
        />

        {/*
          Generic, exactly as it was on the card: it says how a card is used and never anything
          about the track, so it is safe on a screen showing an unflipped card.

          `text-fg-muted` is the dimming the developer asked for, and it is a TOKEN rather than an
          opacity utility for two reasons. An unknown colour utility in this app emits no rule at
          all and fails silently -- which is exactly what happened to this very line once, when it
          read `text-text-muted` and rendered near-black on a near-black card -- so the family is
          asserted in `GameScreen.test.tsx`. And `--color-fg-muted` is the app's audited dimmest
          text at 6.12:1 on `--color-page`, where stacking an `opacity-*` on top of a token would
          take it under the 4.5:1 floor the Phase 8 contrast pass established, without recording a
          number anywhere. It is dimmer than the `text-fg` it carried on the card because it is no
          longer the only thing on a dark face: it sits under a glowing card on the page.
        */}
        <p className="text-xs text-fg-muted">{COPY.game.scanCaption}</p>
      </div>

      {/*
        OUTSIDE the stack, and that placement is a bug fix rather than a layout preference.
        These three buttons were on the card's hidden face until the card became tappable in
        Phase 5, at which point a pointer-up on any of them bubbled into the card's gesture
        handler and flipped the card -- so pressing Play revealed the answer. `CardControls`
        documents it in full.
      */}
      <CardControls
        audio={audio}
        onExit={handleExitRequest}
        onKeepDeck={() => {
          setIsDeckActionsOpen(true);
        }}
      />

      {/*
        ===========================================================================
         THE COPYRIGHT LINE, MID-GAME (2026-08-12).

         It is out of flow, so it adds no row between the controls and the bottom
         of the screen -- what it costs is the `pb-20` band on the `<main>` above,
         which that block accounts for.

         BEFORE THE DIALOGS, so they stay last in the DOM and last in the tab
         order. It makes no difference to what paints on top -- both dialogs are
         `fixed z-50` -- but the tab order is a real ordering and a copyright line
         must not sit after a modal's buttons in it.

         It carries nothing about the deck: `COPYRIGHT_NOTICE` is a module constant,
         which is what keeps this safe beside an unflipped card. Its "2026-present"
         IS a year-shaped string, so the leak proxies that scan whole screens
         subtract it by exact string -- see `LandingScreen.test.tsx`.
        ===========================================================================
      */}
      <Footer />

      {/*
        Last in the DOM, so they are last in the tab order and paint over everything above without
        needing a stacking context of their own. Mounted only while open: an always-present dialog
        hidden with CSS is one `display` rule away from being reachable by Tab while invisible.

        The two are mutually exclusive in practice -- each one's backdrop covers the button that
        opens the other -- so neither has to know the other exists.
      */}
      {isExitConfirmOpen ? (
        <ExitConfirmDialog onConfirm={handleExitConfirmed} onCancel={handleExitCancelled} />
      ) : null}

      {isDeckActionsOpen ? (
        <DeckActionsDialog
          playlistIds={playlistIds}
          playlistName={playlistName}
          seed={seed}
          shareOrigin={shareOrigin}
          onSavePlaylist={onSavePlaylist}
          isPlaylistSaved={isPlaylistSaved}
          // The live deck, so the sheet count and the export both reflect the years that have
          // arrived by the time the player presses. Nothing from it is rendered -- see `DeckActions`.
          deck={deck}
          pendingYearCount={pendingYearCount}
          onClose={() => {
            setIsDeckActionsOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}
