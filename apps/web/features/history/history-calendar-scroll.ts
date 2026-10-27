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

/** Frames to wait after a layout signal so metrics are read post-paint. */
const HISTORY_CALENDAR_SNAP_SETTLE_FRAMES = 2;

/**
 * Keep an overflowing calendar snapped to its latest weeks until the user
 * scrolls it themselves.
 *
 * A single post-render scroll targets stale metrics: react-activity-calendar
 * (v3.2.1) first paints without the client-only weekday-label offset
 * (`isClient` flips in a passive effect, then `marginLeft` grows the content),
 * so a layout-effect snap computes its position against a `scrollWidth` that
 * is about to widen — leaving the latest month clipped. Keep re-snapping after
 * content mutations (library re-render) and box resizes (viewport changes),
 * but permanently stand down the moment a scroll event we did not program, so
 * manual exploration is never overridden.
 *
 * Returns a cleanup that disconnects observers and settles nothing further.
 */
export function attachHistoryCalendarLatestSnap(scroller: HTMLElement | null): () => void {
  if (!scroller) {
    return () => {};
  }

  let destroy = () => {};
  let isUserOwned = false;
  let pendingProgrammaticScrolls = 0;
  let lastProgrammaticScrollLeft: number | null = null;
  let settleFrame = 0;

  const cancelSettle = () => {
    cancelAnimationFrame(settleFrame);
    settleFrame = 0;
  };

  const snapNow = () => {
    if (isUserOwned) {
      return;
    }
    const before = scroller.scrollLeft;
    scrollCalendarToLatest(scroller);
    if (scroller.scrollLeft !== before) {
      pendingProgrammaticScrolls += 1;
      lastProgrammaticScrollLeft = scroller.scrollLeft;
    }
  };

  const onScroll = () => {
    // Our own snap lands as a scroll event; anything else means the user took over.
    if (pendingProgrammaticScrolls > 0 && scroller.scrollLeft === lastProgrammaticScrollLeft) {
      pendingProgrammaticScrolls -= 1;
      return;
    }
    isUserOwned = true;
    destroy();
  };

  const scheduleSettle = () => {
    if (isUserOwned) {
      return;
    }
    cancelSettle();
    let remaining = HISTORY_CALENDAR_SNAP_SETTLE_FRAMES;
    const step = () => {
      settleFrame = requestAnimationFrame(() => {
        settleFrame = 0;
        remaining -= 1;
        if (remaining > 0) {
          step();
          return;
        }
        snapNow();
      });
    };
    step();
  };

  // Content growth that changes no box size (library applies marginLeft to the
  // SVG after first paint) is only visible via a mutation observer.
  const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(scheduleSettle) : null;
  // Viewport/container resizes change the scroller box without a React render.
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleSettle) : null;

  scroller.addEventListener('scroll', onScroll);
  mutationObserver?.observe(scroller, {
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'width'],
  });
  resizeObserver?.observe(scroller);

  destroy = () => {
    cancelSettle();
    scroller.removeEventListener('scroll', onScroll);
    mutationObserver?.disconnect();
    resizeObserver?.disconnect();
  };

  snapNow();
  scheduleSettle();

  return () => destroy();
}
