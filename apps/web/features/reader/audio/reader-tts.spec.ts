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

function hover(container: HTMLElement): void {
  const root = container.querySelector('[data-reader-ui]')!;
  // React maps onMouseEnter through bubbling mouseover + relatedTarget checks.
  act(() => {
    root.dispatchEvent(
      new window.MouseEvent('mouseover', { bubbles: true, cancelable: true, relatedTarget: document.body }),
    );
  });
}

function unhover(container: HTMLElement): void {
  const root = container.querySelector('[data-reader-ui]')!;
  act(() => {
    root.dispatchEvent(
      new window.MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body }),
    );
  });
}

function expandByHover(container: HTMLElement): void {
  hover(container);
}

function expandByLongPress(container: HTMLElement): void {
  const avatar = findButton(container, 'Pause');
  act(() => {
    const down = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'pointerType', { value: 'touch' });
    avatar.dispatchEvent(down);
  });
  advance(420);
  act(() => {
    const up = new window.MouseEvent('pointerup', { bubbles: true, cancelable: true });
    Object.defineProperty(up, 'pointerType', { value: 'touch' });
    avatar.dispatchEvent(up);
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function isCollapsed(container: HTMLElement): boolean {
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
  it('shows only the rotating cover with play/pause while collapsed', () => {
    const container = renderTts(baseProps());

    const avatar = findButton(container, 'Pause');
    expect(avatar.closest('[data-tts-avatar]')).not.toBeNull();
    expect(avatar.getAttribute('aria-expanded')).toBe('false');
    expect(avatar.querySelector('img')?.getAttribute('src')).toBe('/api/assets/cover-1');

    const disc = avatar.querySelector('[style*="animation-play-state"]') as HTMLElement | null;
    expect(disc?.style.animationPlayState).toBe('running');

    // Card controls stay mounted (width 0 / inert); only the cover is interactive while collapsed.
    expect(Array.from(container.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual(
      ['Playback speed 1×, tap to change', 'US accent', 'UK accent', 'Pause'],
    );
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

  it('expands on mouse hover and folds back after four idle seconds', () => {
    const container = renderTts(baseProps());

    expandByHover(container);
    expect(isCollapsed(container)).toBe(false);

    unhover(container);
    advance(3_900);
    expect(isCollapsed(container)).toBe(false);

    advance(200);
    expect(isCollapsed(container)).toBe(true);
  });

  it('keeps the card open while hovered and restarts the countdown on leave', () => {
    const container = renderTts(baseProps());

    expandByHover(container);
    advance(10_000);
    expect(isCollapsed(container)).toBe(false);

    unhover(container);
    advance(3_900);
    expect(isCollapsed(container)).toBe(false);
    advance(200);
    expect(isCollapsed(container)).toBe(true);
  });

  it('expands on touch long-press without toggling playback', () => {
    const props = baseProps();
    const container = renderTts(props);
    const avatar = findButton(container, 'Pause');

    act(() => {
      const down = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      avatar.dispatchEvent(down);
    });
    expect(isCollapsed(container)).toBe(true);

    advance(420);
    expect(isCollapsed(container)).toBe(false);

    act(() => {
      const up = new window.MouseEvent('pointerup', { bubbles: true, cancelable: true });
      Object.defineProperty(up, 'pointerType', { value: 'touch' });
      avatar.dispatchEvent(up);
      avatar.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    });
    // Long-press consumed the gesture — playback stays put.
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('keeps the same cover disc after expand — no secondary play button', () => {
    const container = renderTts(baseProps());

    const avatar = findButton(container, 'Pause');
    const coverBefore = avatar.querySelector('img');

    expandByLongPress(container);
    expect(isCollapsed(container)).toBe(false);
    expect(findButton(container, 'Pause')).toBe(avatar);
    expect(avatar.querySelector('img')).toBe(coverBefore);
    expect(
      Array.from(container.querySelectorAll('button')).filter(
        (element) => element.getAttribute('aria-label') === 'Pause' && !element.closest('[data-tts-avatar]'),
      ),
    ).toHaveLength(0);
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

    expandByLongPress(container);
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

    expandByLongPress(container);
    act(() => {
      document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    });
    expect(isCollapsed(container)).toBe(true);

    expandByLongPress(container);
    act(() => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(isCollapsed(container)).toBe(true);
  });

  it('paints chapter progress into the expanded hairline', () => {
    const getChapterProgress = vi.fn(() => 0.62);
    const container = renderTts(baseProps({ getChapterProgress }));

    expandByLongPress(container);
    advance(1);

    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('62');
    const fill = bar?.querySelector('span') as HTMLElement;
    expect(fill.style.width).toBe('62%');
    expect(getChapterProgress).toHaveBeenCalled();
  });
});
