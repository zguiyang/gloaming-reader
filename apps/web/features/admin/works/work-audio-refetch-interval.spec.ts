import { describe, expect, it } from 'vitest';

import { API_INVALID_RESPONSE_CODE, ApiRequestError } from '@/lib/api-request';

import { WORK_AUDIO_GENERATING_POLL_MS, workAudioRefetchIntervalMs } from './work-audio-refetch-interval';

const generatingData = {
  summary: { generating: 2 },
};

const idleData = {
  summary: { generating: 0 },
};

describe('workAudioRefetchIntervalMs', () => {
  it('polls every 2s when there is no error and parts are generating', () => {
    expect(
      workAudioRefetchIntervalMs({
        error: null,
        data: generatingData,
      }),
    ).toBe(WORK_AUDIO_GENERATING_POLL_MS);
  });

  it('does not poll when there is no error and nothing is generating', () => {
    expect(
      workAudioRefetchIntervalMs({
        error: null,
        data: idleData,
      }),
    ).toBe(false);
  });

  it('does not poll when the latest fetch errored even if stale data shows generating', () => {
    const error = new ApiRequestError({
      message: '响应格式无效',
      status: 502,
      code: API_INVALID_RESPONSE_CODE,
    });
    expect(
      workAudioRefetchIntervalMs({
        error,
        data: generatingData,
      }),
    ).toBe(false);
  });
});
