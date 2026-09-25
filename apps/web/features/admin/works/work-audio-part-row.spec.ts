import { describe, expect, it, vi } from 'vitest';

import { invalidateAudioPlayEpoch, shouldCommitAudioPlay, stopHtmlAudioElement } from './work-audio-part-row';

describe('invalidateAudioPlayEpoch', () => {
  it('increments and returns the new epoch', () => {
    const epochRef = { current: 0 };
    expect(invalidateAudioPlayEpoch(epochRef)).toBe(1);
    expect(epochRef.current).toBe(1);
    expect(invalidateAudioPlayEpoch(epochRef)).toBe(2);
  });
});

describe('shouldCommitAudioPlay', () => {
  it('commits only when the attempt matches the current epoch', () => {
    const epochRef = { current: 3 };
    expect(shouldCommitAudioPlay(3, epochRef)).toBe(true);
    expect(shouldCommitAudioPlay(2, epochRef)).toBe(false);
    invalidateAudioPlayEpoch(epochRef);
    expect(shouldCommitAudioPlay(3, epochRef)).toBe(false);
    expect(shouldCommitAudioPlay(4, epochRef)).toBe(true);
  });

  it('stale success after play() resolves is discarded without stopping the element', () => {
    const epochRef = { current: 2 };
    const attemptEpoch = 1;
    const audio = {
      pause: vi.fn(),
      currentTime: 0,
    } as unknown as HTMLAudioElement;

    if (!shouldCommitAudioPlay(attemptEpoch, epochRef)) {
      expect(audio.pause).not.toHaveBeenCalled();
      return;
    }

    throw new Error('unexpected commit');
  });
});

describe('stopHtmlAudioElement', () => {
  it('pauses and resets currentTime when possible', () => {
    const audio = {
      pause: vi.fn(),
      currentTime: 12,
    } as unknown as HTMLAudioElement;

    stopHtmlAudioElement(audio);

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
  });

  it('still pauses when currentTime cannot be reset', () => {
    const audio = {
      pause: vi.fn(),
      currentTime: 5,
    } as unknown as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', {
      set() {
        throw new Error('not ready');
      },
      get() {
        return 5;
      },
    });

    stopHtmlAudioElement(audio);

    expect(audio.pause).toHaveBeenCalledOnce();
  });
});
