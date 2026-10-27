// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { ActivityCalendar } from 'react-activity-calendar';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  findHistoryCalendarScroller,
  HISTORY_CALENDAR_SCROLL_SELECTOR,
  scrollCalendarToLatest,
} from './history-calendar-scroll';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** Simulate layout metrics happy-dom does not compute (always 0). */
function mockScrollMetrics(scroller: HTMLElement, metrics: { scrollWidth: number; clientWidth: number }): void {
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: metrics.scrollWidth });
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: metrics.clientWidth });
}

describe('history calendar scroller selector (installed react-activity-calendar DOM)', () => {
  it('matches the scroll container the installed library actually renders', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(ActivityCalendar, {
          data: [
            { date: '2026-08-01', count: 0, level: 0 },
            { date: '2026-08-02', count: 600, level: 4 },
          ],
          showTotalCount: false,
        }),
      ),
    );

    // The library composes its class as `${NAMESPACE}__scroll-container` (v3.2.1).
    expect(container.querySelector(HISTORY_CALENDAR_SCROLL_SELECTOR)).not.toBeNull();
    const scroller = findHistoryCalendarScroller(container);
    expect(scroller).not.toBeNull();
    // Overflow scrolls inside this node (overflow-x: auto), not the <article>.
    expect(scroller?.parentElement?.tagName).toBe('ARTICLE');

    await act(async () => root.unmount());
    container.remove();
  });

  it('does not match the legacy single-underscore selector that never scrolled', () => {
    const container = document.createElement('div');
    container.innerHTML = '<article><div class="react-activity-calendar__scroll-container"></div></article>';
    expect(container.querySelector('.react-activity-calendar-scroll-container')).toBeNull();
    expect(findHistoryCalendarScroller(container)).not.toBeNull();
  });
});

describe('scrollCalendarToLatest', () => {
  function overflowingScroller(): HTMLElement {
    const scroller = document.createElement('div');
    mockScrollMetrics(scroller, { scrollWidth: 600, clientWidth: 320 });
    return scroller;
  }

  it('snaps an overflowing mobile scroller to the latest (rightmost) weeks', () => {
    const scroller = overflowingScroller();
    scrollCalendarToLatest(scroller);
    expect(scroller.scrollLeft).toBe(280);
  });

  it('does nothing when the calendar already fits', () => {
    const scroller = document.createElement('div');
    mockScrollMetrics(scroller, { scrollWidth: 320, clientWidth: 320 });
    scroller.scrollLeft = 0;
    scrollCalendarToLatest(scroller);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('tolerates sub-pixel rounding of a one-pixel overflow', () => {
    const scroller = document.createElement('div');
    mockScrollMetrics(scroller, { scrollWidth: 321, clientWidth: 320 });
    scroller.scrollLeft = 0;
    scrollCalendarToLatest(scroller);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('is a no-op when the scroll container is missing or hidden', () => {
    expect(() => scrollCalendarToLatest(null)).not.toThrow();
    const hidden = document.createElement('div');
    mockScrollMetrics(hidden, { scrollWidth: 0, clientWidth: 0 });
    scrollCalendarToLatest(hidden);
    expect(hidden.scrollLeft).toBe(0);
  });
});
