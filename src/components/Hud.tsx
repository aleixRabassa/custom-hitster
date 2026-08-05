/**
 * The in-game HUD: how many cards are left, and nothing else.
 *
 * ===========================================================================
 *  COUNTS ONLY. NO TRACK INFORMATION OF ANY KIND.
 *
 *  This sits above an UNFLIPPED card for the whole game, which makes it a leak
 *  surface with the longest exposure of any in the app. "Up next: Queen" is the
 *  kind of thing that gets added to a HUD, and it would end the game.
 * ===========================================================================
 *
 * ## No Exit button here
 *
 * Exit is one of the three controls in `CardControls`, beside the card. Two exits would be two
 * things to keep in step, and `plan.md` §5 is explicit that there is no separate End Game button.
 * `Hud.test.tsx` asserts the absence, because "the HUD should have a quit button" is a natural
 * thing to want and the second one is how one of them quietly stops working.
 */

export interface HudProps {
  /**
   * Cards still to come AFTER the current one, from `cardsRemaining`. Zero on the last card, which
   * is why the copy below says "left" rather than a fraction -- "0 of 42" would read as an error
   * on the card a player is still holding.
   */
  cardsRemaining: number;
  /** The playlist's name, from `state.playlist`. Playlist-level, so it reveals nothing about a card. */
  playlistName: string;
}

export function Hud({ cardsRemaining, playlistName }: HudProps) {
  return (
    <div
      data-testid="hud"
      className="flex w-full max-w-sm items-baseline justify-between gap-3 text-xs text-neutral-500"
    >
      {/*
        The playlist NAME is safe and the track titles are not, which is worth stating because the
        distinction is the whole leak rule in miniature: a player chose this playlist and already
        knows what it is called. `truncate` because a user-created playlist name has no length
        limit worth relying on.
      */}
      <span className="truncate">{playlistName}</span>

      {/*
        `role="status"` so the count is announced as it changes -- it is the only feedback a
        screen-reader user gets that a swipe actually advanced the deck.
      */}
      <span role="status" className="shrink-0 tabular-nums">
        {cardsRemaining === 1 ? '1 card left' : `${cardsRemaining} cards left`}
      </span>
    </div>
  );
}
