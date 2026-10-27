// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, useRef } from 'react';
import { ActivityCalendar } from 'react-activity-calendar';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  attachHistoryCalendarLatestSnap,
  findHistoryCalendarScroller,
  HISTORY_CALENDAR_SCROLL_SELECTOR,
  scrollCalendarToLatest,
} from './history-calendar-scroll';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** Await past the controller's double-requestAnimationFrame settle chain. */
function settleLayout(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

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

describe('attachHistoryCalendarLatestSnap (live 390px regression)', () => {
  const CLIENT_WIDTH = 308;
  /** Live frame: 53 weeks × (8 + 3) − 3 = 580 before the weekday-label offset. */
  const SVG_WIDTH = 580;
  /** CJK weekday label ≈ 24px + library LABEL_MARGIN 8, applied post-paint. */
  const WEEKDAY_LABEL_OFFSET = 32;

  beforeAll(() => {
    // happy-dom reports zero text metrics; pin a CJK-sized label width so the
    // library applies the same client-only margin shift seen on a live device.
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    let proto: object | null = Object.getPrototypeOf(probe);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, 'getBBox')) {
      proto = Object.getPrototypeOf(proto);
    }
    expect(proto, 'SVG text getBBox prototype').not.toBeNull();
    Object.defineProperty(proto!, 'getBBox', {
      configurable: true,
      value: () => ({ width: 24, height: 12 }),
    });
  });

  /**
   * Mirror the live layout relationship happy-dom cannot compute: the scroller
   * is as wide as the calendar SVG plus the library's client-only weekday
   * `marginLeft` (react-activity-calendar v3.2.1 paints without it, then adds
   * it from a passive effect after `isClient` flips).
   */
  function mockLiveLayout(scroller: HTMLElement, clientWidth: number = CLIENT_WIDTH): void {
    const svg = scroller.querySelector('svg');
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => clientWidth });
    Object.defineProperty(scroller, 'scrollWidth', {
      configurable: true,
      get: () => Number(svg?.getAttribute('width') ?? 0) + (Number.parseFloat(svg?.style.marginLeft ?? '') || 0),
    });
  }

  function fullYearData(end: string): Array<{ date: string; count: number; level: number }> {
    const endMs = Date.parse(`${end}T00:00:00Z`);
    return Array.from({ length: 365 }, (_, index) => ({
      date: new Date(endMs - (364 - index) * 86_400_000).toISOString().slice(0, 10),
      count: 0,
      level: 0,
    }));
  }

  it('re-snaps after the library widens the content post-paint, then stops at the final max', async () => {
    let destroy: (() => void) | undefined;
    const snapTrajectory: number[] = [];
    function Harness() {
      const frameRef = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => {
        const scroller = findHistoryCalendarScroller(frameRef.current ?? document);
        expect(scroller).not.toBeNull();
        mockLiveLayout(scroller!);
        // Record every position so the test can prove the stale first snap happened.
        let scrollLeft = 0;
        Object.defineProperty(scroller!, 'scrollLeft', {
          configurable: true,
          get: () => scrollLeft,
          set: (value: number) => {
            scrollLeft = value;
            snapTrajectory.push(value);
          },
        });
        destroy = attachHistoryCalendarLatestSnap(scroller);
      }, []);
      return createElement(
        'div',
        { ref: frameRef },
        createElement(ActivityCalendar, {
          data: fullYearData('2026-10-27'),
          blockSize: 8,
          blockMargin: 3,
          fontSize: 12,
          maxLevel: 4,
          showMonthLabels: true,
          showWeekdayLabels: ['mon', 'wed', 'fri'],
          showTotalCount: false,
        }),
      );
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));

    const scroller = findHistoryCalendarScroller(container);
    expect(scroller).not.toBeNull();
    // The library's passive effect applied the client-only weekday-label
    // offset after first paint: scrollWidth matches the live 612 (580 + 32).
    await settleLayout();
    expect(scroller!.scrollWidth).toBe(SVG_WIDTH + WEEKDAY_LABEL_OFFSET);
    // Final max is 612 − 308 = 304; a one-shot layout-effect snap stayed at
    // the stale 272 (580 − 308) and clipped the October label (x=340..364).
    expect(scroller!.scrollLeft).toBe(scroller!.scrollWidth - CLIENT_WIDTH);
    expect(scroller!.scrollLeft).toBe(SVG_WIDTH + WEEKDAY_LABEL_OFFSET - CLIENT_WIDTH);
    // The stale first snap really happened (pre-offset max) before the re-snap.
    expect(snapTrajectory).toContain(SVG_WIDTH - CLIENT_WIDTH);

    destroy?.();
    await act(async () => root.unmount());
    container.remove();
  });

  it('stands down permanently once the user scrolls, even if metrics change later', async () => {
    const scroller = document.createElement('div');
    const content = document.createElement('div');
    scroller.appendChild(content);
    let scrollWidth = 600;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, get: () => scrollWidth });

    const destroy = attachHistoryCalendarLatestSnap(scroller);
    await settleLayout();
    expect(scroller.scrollLeft).toBe(280);

    // Simulate a manual scroll: a scroll event at a position we did not program.
    scroller.scrollLeft = 120;
    scroller.dispatchEvent(new Event('scroll'));

    // Content and box signals that previously triggered re-snaps.
    scrollWidth = 900;
    content.style.marginLeft = '64px';
    await settleLayout();
    expect(scroller.scrollLeft).toBe(120);
    destroy();
  });

  it('does not mistake its own programmatic scroll for user takeover', async () => {
    const scroller = document.createElement('div');
    const content = document.createElement('div');
    scroller.appendChild(content);
    let scrollWidth = 600;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, get: () => scrollWidth });

    const destroy = attachHistoryCalendarLatestSnap(scroller);
    await settleLayout();
    expect(scroller.scrollLeft).toBe(280);

    // The browser delivers our snap as a scroll event at the position we set.
    scroller.dispatchEvent(new Event('scroll'));

    // A later layout shift must still re-snap: ownership stays with the controller.
    scrollWidth = 700;
    content.style.marginLeft = '16px';
    await settleLayout();
    expect(scroller.scrollLeft).toBe(380);
    destroy();
  });

  it('keeps a fitting calendar untouched', async () => {
    const scroller = document.createElement('div');
    const content = document.createElement('div');
    scroller.appendChild(content);
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 320 });

    const destroy = attachHistoryCalendarLatestSnap(scroller);
    content.style.marginLeft = '4px';
    await settleLayout();
    expect(scroller.scrollLeft).toBe(0);
    destroy();
  });

  it('tolerates a missing scroller and repeated cleanup', () => {
    expect(() => attachHistoryCalendarLatestSnap(null)()).not.toThrow();
    const scroller = document.createElement('div');
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 0 });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 0 });
    const destroy = attachHistoryCalendarLatestSnap(scroller);
    expect(() => {
      destroy();
      destroy();
    }).not.toThrow();
  });
});
