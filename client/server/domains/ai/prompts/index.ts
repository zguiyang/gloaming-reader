export type { PromptRoleId, PromptSceneId } from '@/server/domains/ai/prompts/ids';
export { ASSIST_ACTION_TEMPLATE, PROMPT_ROLE, PROMPT_SCENE } from '@/server/domains/ai/prompts/ids';
export type { ComposePromptInput, PromptMessage, PromptVars } from '@/server/domains/ai/prompts/service';
export {
  clearPromptTemplateCache,
  composePromptMessages,
  getPromptTemplate,
  renderPrompt,
} from '@/server/domains/ai/prompts/service';
