import { listWireFamilies } from '@/shared/llm';

export async function getWireRegistry() {
  return { families: listWireFamilies() };
}
