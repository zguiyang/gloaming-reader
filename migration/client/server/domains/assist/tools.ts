import type { AssistAskBody } from '@gloaming/shared/assist';

import type { AiToolHandle } from '@/server/domains/ai/runtime/types';
import type { WorkReadActor } from '@/server/domains/works/access';

type PartRef = {
  title: string;
  body: string;
  workId: string;
  partId: string;
};

/**
 * Assist tools — Wave 2 stub without LangChain.
 * Full dictionary/slice tools remain in `_legacy_hono/deferred` until AI SDK tool wiring.
 */
export function createPartAssistTools(_actor: WorkReadActor, _part: PartRef): AiToolHandle[] {
  return [];
}

export function resolveAssistToolsForAction(
  _actionId: AssistAskBody['actionId'],
  _part: PartRef,
  _actor?: WorkReadActor,
): AiToolHandle[] {
  return [];
}
