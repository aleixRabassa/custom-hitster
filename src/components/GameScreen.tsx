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
import { Hud } from './Hud';
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
  /** The playlist's name, from `state.playlist`. Playlist-level only — never track data. */
  playlistName: string;
  /**
   * The playlist's Spotify id, from `state.playlist`. One half of the share link.
   *
   * These five are the deck-actions props, straight through to `DeckActionsDialog` and used for
   * nothing else here. They are playlist-level and seed-level -- not one of them derives from a
   * card, which is what keeps this screen's leak story unchanged by the whole feature.
   */
  playlistId: string;
  /** The seed this deck was dealt with, from `state.seed`. The other half of the link. */
  seed: string;
  /** Where a shared link should point -- `origin + pathname`, supplied by the container. */
  shareOrigin: string;
  /** Save this playlist to the landing screen's library. */
  onSavePlaylist: () => void;
  /** True once this playlist is in the library. Turns the save button into its own confirmation. */
  isPlaylistSaved: boolean;
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
  playlistId,
  seed,
  shareOrigin,
  onSavePlaylist,
  isPlaylistSaved,
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

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-page p-6">
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
          playlistId={playlistId}
          playlistName={playlistName}
          seed={seed}
          shareOrigin={shareOrigin}
          onSavePlaylist={onSavePlaylist}
          isPlaylistSaved={isPlaylistSaved}
          // The live deck, so the sheet count and the export both reflect the years that have
          // arrived by the time the player presses. Nothing from it is rendered -- see `DeckActions`.
          deck={deck}
          onClose={() => {
            setIsDeckActionsOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}
