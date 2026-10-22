// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/lib/locale-context';

import { ReaderTts } from './reader-tts';

type ReaderTtsProps = Parameters<typeof ReaderTts>[0];

function baseProps(overrides: Partial<ReaderTtsProps> = {}): ReaderTtsProps {
  return {
    status: 'playing',
    playbackRate: 1,
    tocOpen: false,
    audioRole: 'us',
    coverUrl: '/api/assets/cover-1',
    workTitle: 'The Great Gatsby',
    getChapterProgress: () => 0.25,
    onToggle: vi.fn(),
    onCyclePlaybackRate: vi.fn(),
    onSelectRole: vi.fn(),
    ...overrides,
  };
}

const mounted: Array<() => void> = [];

function renderTts(props: ReaderTtsProps): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      // eslint-disable-next-line react/no-children-prop
      createElement(LocaleProvider, { locale: 'en-US', children: createElement(ReaderTts, props) }),
    );
  });
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function findButton(container: HTMLElement, ariaLabel: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.getAttribute('aria-label') === ariaLabel,
  );
  if (!button) {
    throw new Error(`No button with aria-label "${ariaLabel}"`);
  }
  return button;
}

function click(button: HTMLElement): void {
  act(() => {
    // detail > 0 marks a pointer activation, matching a real mouse click.
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
}

function pointerEvent(type: string, pointerType: string): MouseEvent {
  const event = new window.MouseEvent(type, { bubbles: true, relatedTarget: document.body });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

function hover(container: HTMLElement, pointerType = 'mouse'): void {
  const root = container.querySelector('[data-reader-ui]')!;
  act(() => {
    root.dispatchEvent(pointerEvent('pointerover', pointerType));
  });
}

function unhover(container: HTMLElement, pointerType = 'mouse'): void {
  const root = container.querySelector('[data-reader-ui]')!;
  act(() => {
    root.dispatchEvent(pointerEvent('pointerout', pointerType));
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function isCollapsed(container: HTMLElement): boolean {
  // Every expanded-pill control is inert while the avatar is showing.
  return findButton(container, 'UK accent').closest('[inert]') !== null;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (mounted.length) {
    mounted.pop()?.();
  }
  vi.useRealTimers();
});

describe('ReaderTts mini player', () => {
  it('shows the cover as a rotating avatar with play/pause at its centre', () => {
    const container = renderTts(baseProps());

    const avatar = findButton(container, 'Pause');
    const cover = avatar.querySelector('img');
    expect(cover?.getAttribute('src')).toBe('/api/assets/cover-1');

    // The cover spins only while playing, and pausing freezes it in place.
    const disc = avatar.querySelector('[style*="animation-play-state"]') as HTMLElement | null;
    expect(disc?.style.animationPlayState).toBe('running');

    const expandTrigger = findButton(container, 'Expand playback controls');
    expect(expandTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(isCollapsed(container)).toBe(true);
  });

  it('freezes the avatar and shows the play control when paused', () => {
    const container = renderTts(baseProps({ status: 'paused' }));

    const avatar = findButton(container, 'Play');
    const disc = avatar.querySelector('[style*="animation-play-state"]') as HTMLElement | null;
    expect(disc?.style.animationPlayState).toBe('paused');
  });

  it('masks the avatar with a spinner instead of a play control while loading', () => {
    const container = renderTts(baseProps({ status: 'loading' }));

    const avatar = findButton(container, 'Loading audio');
    expect((avatar as HTMLButtonElement).disabled).toBe(true);
    expect(avatar.querySelector('.animate-spin')).not.toBeNull();
  });

  it('expands on the arrow and folds back after four idle seconds', () => {
    const container = renderTts(baseProps());

    click(findButton(container, 'Expand playback controls'));
    expect(isCollapsed(container)).toBe(false);

    advance(3_900);
    expect(isCollapsed(container)).toBe(false);

    advance(200);
    expect(isCollapsed(container)).toBe(true);
  });

  it('keeps the pill open while hovered and restarts the countdown on leave', () => {
    const container = renderTts(baseProps());

    click(findButton(container, 'Expand playback controls'));
    hover(container);
    advance(10_000);
    expect(isCollapsed(container)).toBe(false);

    unhover(container);
    advance(3_900);
    expect(isCollapsed(container)).toBe(false);
    advance(200);
    expect(isCollapsed(container)).toBe(true);
  });

  it('does not treat a touch pointer as hover, so the pill still auto-collapses', () => {
    const container = renderTts(baseProps());

    click(findButton(container, 'Expand playback controls'));
    hover(container, 'touch');
    advance(10_000);

    expect(isCollapsed(container)).toBe(true);
  });

  it('moves focus into the revealed controls when expanding', () => {
    const container = renderTts(baseProps());

    click(findButton(container, 'Expand playback controls'));
    advance(1);

    const panelPlay = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('aria-label') === 'Pause' && !element.closest('[inert]'),
    );
    expect(panelPlay).toBeDefined();
    expect(document.activeElement).toBe(panelPlay);
  });

  it('falls back to the title initial when the cover image fails to load', () => {
    const container = renderTts(baseProps());

    const cover = container.querySelector('[data-reader-ui] img') as HTMLImageElement;
    expect(cover).not.toBeNull();
    act(() => {
      cover.dispatchEvent(new window.Event('error'));
    });

    expect(container.querySelector('[data-reader-ui] img')).toBeNull();
    expect(container.textContent).toContain('T');
  });

  it('shows a retry affordance in the error state', () => {
    const props = baseProps({ status: 'error' });
    const container = renderTts(props);

    click(findButton(container, 'Retry'));

    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown when a control is used', () => {
    const props = baseProps();
    const container = renderTts(props);

    click(findButton(container, 'Expand playback controls'));
    advance(3_000);
    click(findButton(container, 'Playback speed 1×, tap to change'));
    expect(props.onCyclePlaybackRate).toHaveBeenCalledTimes(1);

    advance(3_500);
    expect(isCollapsed(container)).toBe(false);
    advance(600);
    expect(isCollapsed(container)).toBe(true);
  });

  it('collapses on an outside press and on Escape', () => {
    const container = renderTts(baseProps());

    click(findButton(container, 'Expand playback controls'));
    act(() => {
      document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    });
    expect(isCollapsed(container)).toBe(true);

    click(findButton(container, 'Expand playback controls'));
    act(() => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(isCollapsed(container)).toBe(true);
  });

  it('hands keyboard focus back to the expand trigger when Escape closes the pill', () => {
    const container = renderTts(baseProps());

    click(findButton(container, 'Expand playback controls'));
    act(() => findButton(container, 'Playback speed 1×, tap to change').focus());

    act(() => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(document.activeElement).toBe(findButton(container, 'Expand playback controls'));
  });

  it('paints chapter progress into the expanded hairline', () => {
    const getChapterProgress = vi.fn(() => 0.62);
    const container = renderTts(baseProps({ getChapterProgress }));

    click(findButton(container, 'Expand playback controls'));

    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('62');
    const fill = bar?.querySelector('span') as HTMLElement;
    expect(fill.style.width).toBe('62%');
    expect(getChapterProgress).toHaveBeenCalled();
  });
});
