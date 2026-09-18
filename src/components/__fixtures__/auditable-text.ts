/**
 * The leak proxies' view of a rendered screen: everything on it a track title, an artist or a
 * year could hide in.
 *
 * A TEST helper beside the fixture deck rather than beside the components, for the same reason
 * `cards.ts` is here: its only importers are tests, it must never reach the app, and the two
 * things a leak assertion needs -- something to look for and somewhere to look -- belong together.
 *
 * ===========================================================================
 *  ONE OWNER FOR THE ATTRIBUTE LIST, AS OF 2026-09-19.
 *
 *  This function was a verbatim copy in `LandingScreen.test.tsx` and
 *  `WelcomeScreen.test.tsx`, which gave the list of audited attributes two
 *  owners -- and the `download` gap below was found in one copy, which means
 *  it would have been fixed in one copy. Both of those files now read this
 *  one list, so widening it once widens both proxies. (`PreparingScreen`'s
 *  proxy still audits `textContent` alone; that screen renders no attribute
 *  a person meets, and it is not a caller of this helper today.)
 *
 *  `textContent` ALONE STOPPED BEING ENOUGH ON 2026-08-12, and nothing failed
 *  when it did: the picker's `<h1>` became `<img alt="Playlist Jitster">`, and
 *  `textContent` does not include `alt`. AGENTS.md lists `alt` text,
 *  `aria-label`s and attributes as leak surfaces in their own right; this is
 *  the proxy catching up with the rule.
 *
 *  `download` AND `href` JOINED THE LIST ON 2026-09-19, and the reason is the
 *  same shape again. The welcome screen's one year-shaped text is the printed
 *  range "1970-2033", and it is NOT in any sentence: it is the PDF's saved
 *  name (the link's `download` attribute) and the asset's path (its `href`).
 *  Neither was audited, so the proxy passed by OMISSION -- a range that was
 *  believed to be subtracted by exact string was in fact never read. A
 *  `download` value is what a player sees in their downloads list, and an
 *  `href` shows on hover, on a long-press sheet and under "copy link", so both
 *  are read by a person even though neither is read aloud. The list is the
 *  attributes a PERSON meets, not the attributes a screen reader speaks.
 *
 *  `placeholder` and `value` are in the list because the suggestion buttons
 *  fill a row's value, and a future "recently played" affordance would fill it
 *  with something derived from a deck.
 *
 *  THE HELPER SUBTRACTS NOTHING. Which strings a screen carries by design --
 *  `COPYRIGHT_NOTICE`, the footer's author URL, the welcome screen's printed
 *  range -- is the calling test's decision and stays visible in that test, as
 *  a `.replace(EXACT_STRING, '')` chain, so the proxy stays absolute for
 *  everything a test did not name.
 * ===========================================================================
 */

/** The attributes a person meets on a screen, whether or not assistive technology speaks them. */
const AUDITED_ATTRIBUTES = [
  'alt',
  'aria-label',
  'title',
  'placeholder',
  'value',
  'download',
  'href',
] as const;

/**
 * The rendered text and every audited attribute of every element, joined with spaces so the
 * `\b(19|20)\d{2}\b` proxy sees a boundary between one attribute's end and the next one's start.
 */
export function auditableText(container: HTMLElement): string {
  const attributes = [...container.querySelectorAll('*')].flatMap((element) =>
    AUDITED_ATTRIBUTES.map((name) => element.getAttribute(name) ?? ''),
  );

  return [container.textContent ?? '', ...attributes].join(' ');
}
