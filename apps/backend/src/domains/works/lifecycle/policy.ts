import type { AdminWorkflowPolicy } from '@gloaming/shared/works';

/** Backend-owned workflow switches. Manual pipeline and TTS-off remain the defaults. */
export const WORKFLOW_AUTO_CHAIN = false;
export const TTS_STEP_ENABLED = false;

export const WORKFLOW_POLICY = {
  autoChainEnabled: WORKFLOW_AUTO_CHAIN,
  ttsStepEnabled: TTS_STEP_ENABLED,
} as const satisfies AdminWorkflowPolicy;

export function getWorkflowPolicyProjection(): AdminWorkflowPolicy {
  return { ...WORKFLOW_POLICY };
}
