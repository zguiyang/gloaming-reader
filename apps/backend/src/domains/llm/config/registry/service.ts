import { listWireFamilies } from '@gloaming/shared/llm';

export async function getWireRegistry() {
  return { families: listWireFamilies() };
}
