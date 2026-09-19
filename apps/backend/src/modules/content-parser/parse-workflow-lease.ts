import { renewWorkflowClaim } from '@/lib/workflow';

const PARSE_LEASE_HEARTBEAT_MS = 5 * 60 * 1000;

export class ParseWorkflowLeaseLostError extends Error {
  constructor() {
    super('Parse workflow lease lost');
    this.name = 'ParseWorkflowLeaseLostError';
  }
}

type ParseLeaseLogger = {
  warn: (fields: { err: unknown; workId: string; attemptToken: string }, message: string) => void;
};

export type ParseWorkflowLease = {
  ensureOwned: () => Promise<void>;
  isLeaseLost: () => boolean;
  stopHeartbeat: () => void;
};

export function startParseWorkflowLease(options: {
  workId: string;
  jobToken: string;
  attemptToken: string;
  logger: ParseLeaseLogger;
}): ParseWorkflowLease {
  const { workId, jobToken, attemptToken, logger } = options;
  let leaseLost = false;
  let heartbeat: Promise<void> | null = null;

  const renew = async (): Promise<boolean> => {
    if (leaseLost) {
      return false;
    }
    try {
      const owned = await renewWorkflowClaim(workId, 'parse', jobToken, attemptToken);
      if (!owned) {
        leaseLost = true;
      }
      return owned;
    } catch (error) {
      leaseLost = true;
      logger.warn({ err: error, workId, attemptToken }, 'Parse workflow lease renewal failed');
      return false;
    }
  };

  const ensureOwned = async (): Promise<void> => {
    if (!(await renew())) {
      throw new ParseWorkflowLeaseLostError();
    }
  };

  const heartbeatTimer = setInterval(() => {
    if (!heartbeat) {
      heartbeat = renew()
        .then(() => undefined)
        .finally(() => {
          heartbeat = null;
        });
    }
  }, PARSE_LEASE_HEARTBEAT_MS);

  return {
    ensureOwned,
    isLeaseLost: () => leaseLost,
    stopHeartbeat: () => {
      clearInterval(heartbeatTimer);
    },
  };
}
