/**
 * react-activity-calendar names its horizontal scroll wrapper
 * `react-activity-calendar__scroll-container` (its internal getClassName:
 * `<namespace>__<element>`, v3.2.1). Overflow scrolls inside this element, not
 * the outer `<article>`, so the latest (rightmost) weeks can only be brought
 * into view by scrolling this node.
 */
export const HISTORY_CALENDAR_SCROLL_SELECTOR = '.react-activity-calendar__scroll-container';

export function findHistoryCalendarScroller(root: ParentNode): HTMLElement | null {
  const scroller = root.querySelector(HISTORY_CALENDAR_SCROLL_SELECTOR);
  return scroller instanceof HTMLElement ? scroller : null;
}

/**
 * Snap an overflowing horizontal calendar scroller to its latest (rightmost)
 * data so the most recent weeks are visible on first paint (mobile, where the
 * year window cannot fit even at the minimum block size). No-op when the
 * element is missing, hidden, or the content already fits — never forces a
 * scrollbar or touches a position that is already correct.
 */
export function scrollCalendarToLatest(scroller: HTMLElement | null): void {
  if (!scroller) {
    return;
  }
  // +1px slack absorbs sub-pixel layout rounding of the SVG width.
  if (scroller.scrollWidth <= scroller.clientWidth + 1) {
    return;
  }
  scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
}

/**
 * Pixel tolerance for classifying scroll events. Real browsers report scroll
 * positions quantized to device pixels (zoom, DPR, fractional layout), so a
 * position we programmed can read back 1px off from what we assigned.
 */
const HISTORY_CALENDAR_SCROLL_POSITION_TOLERANCE_PX = 1;
/** How many recent programmatic positions stay eligible for match. */
const HISTORY_CALENDAR_PROGRAMMATIC_MEMORY = 3;

/**
 * Keep an overflowing calendar snapped to its latest weeks until the user
 * scrolls it themselves.
 *
 * A single post-render scroll targets stale metrics: react-activity-calendar
 * (v3.2.1) first paints without the client-only weekday-label offset
 * (`isClient` flips in a passive effect, then `marginLeft` grows the content
 * from 580px to 612px on a 390px phone), so an initial snap computes its
 * position against a `scrollWidth` that is about to widen — leaving the latest
 * month clipped. Re-snap synchronously whenever the content mutates (library
 * re-render) or the scroller box resizes (viewport/container change). Reading
 * `scrollWidth` in the observer callback forces layout against current
 * styles, so no requestAnimationFrame settle is needed — frames may be
 * throttled or suspended in backgrounded tabs and embedded webviews, and a
 * rAF-gated re-snap then never lands (live repro: stuck at 272 of max 304).
 *
 * Stand down permanently on a scroll we did not program so manual exploration
 * is never overridden. Classification is positional with tolerance, not
 * equality: browsers clamp and quantize scroll offsets and may deliver our
 * own scroll events coalesced or out of order, so an exact-match rule misreads
 * the controller's own snap as user takeover. A scroll landing within
 * tolerance of a recent programmatic position — or of the current maximum,
 * which is where clamping or a user flick-to-end lands — is not takeover.
 *
 * Returns a cleanup that disconnects observers and settles nothing further.
 */
export function attachHistoryCalendarLatestSnap(scroller: HTMLElement | null): () => void {
  if (!scroller) {
    return () => {};
  }

  let destroy = () => {};
  let isUserOwned = false;
  const programmaticPositions: number[] = [];

  const withinTolerance = (a: number, b: number) => Math.abs(a - b) <= HISTORY_CALENDAR_SCROLL_POSITION_TOLERANCE_PX;

  const snapNow = () => {
    if (isUserOwned) {
      return;
    }
    const before = scroller.scrollLeft;
    scrollCalendarToLatest(scroller);
    if (scroller.scrollLeft !== before) {
      programmaticPositions.push(scroller.scrollLeft);
      if (programmaticPositions.length > HISTORY_CALENDAR_PROGRAMMATIC_MEMORY) {
        programmaticPositions.shift();
      }
    }
  };

  const onScroll = () => {
    const position = scroller.scrollLeft;
    const isLatest = withinTolerance(position, scroller.scrollWidth - scroller.clientWidth);
    if (isLatest || programmaticPositions.some((programmatic) => withinTolerance(position, programmatic))) {
      return;
    }
    isUserOwned = true;
    destroy();
  };

  // Content growth that changes no box size (library applies marginLeft to the
  // SVG after first paint) is only visible via a mutation observer.
  const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(snapNow) : null;
  // Viewport/container resizes change the scroller box without a React render.
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(snapNow) : null;

  scroller.addEventListener('scroll', onScroll);
  mutationObserver?.observe(scroller, {
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'width'],
  });
  resizeObserver?.observe(scroller);

  destroy = () => {
    scroller.removeEventListener('scroll', onScroll);
    mutationObserver?.disconnect();
    resizeObserver?.disconnect();
  };

  snapNow();

  return () => destroy();
}
