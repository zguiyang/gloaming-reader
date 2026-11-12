import { isRuntimeImplemented, type LlmApiFamily } from '@/shared/llm';

export function isModelRuntimeReady(apiFamily: LlmApiFamily): boolean {
  return isRuntimeImplemented(apiFamily);
}
