/** Poll interval while work audio parts are generating (ms). */
export const WORK_AUDIO_GENERATING_POLL_MS = 2000;

export type WorkAudioRefetchIntervalInput = {
  error: unknown;
  data: { summary: { generating: number } } | undefined;
};

/**
 * TanStack Query refetchInterval decision for admin work audio polling.
 * Stops when the latest fetch errored, even if stale data still shows generating.
 */
export function workAudioRefetchIntervalMs(input: WorkAudioRefetchIntervalInput): number | false {
  if (input.error != null) {
    return false;
  }
  const data = input.data;
  if (!data) {
    return false;
  }
  return data.summary.generating > 0 ? WORK_AUDIO_GENERATING_POLL_MS : false;
}
