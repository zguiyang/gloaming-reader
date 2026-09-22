export const JOB_PING = 'ping';

export type PingJobData = {
  requestedAt: string;
};

export function processPing(data: PingJobData): { ok: true; requestedAt: string } {
  return { ok: true, requestedAt: data.requestedAt };
}
