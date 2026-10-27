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
