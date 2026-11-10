import { isRuntimeImplemented, type LlmApiFamily } from '@gloaming/shared/llm';

export function isModelRuntimeReady(apiFamily: LlmApiFamily): boolean {
  return isRuntimeImplemented(apiFamily);
}
