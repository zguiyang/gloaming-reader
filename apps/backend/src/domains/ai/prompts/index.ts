export type { PromptRoleId, PromptSceneId } from '@/domains/ai/prompts/ids';
export { ASSIST_ACTION_TEMPLATE, PROMPT_ROLE, PROMPT_SCENE } from '@/domains/ai/prompts/ids';
export type { ComposePromptInput, PromptMessage, PromptVars } from '@/domains/ai/prompts/service';
export {
  clearPromptTemplateCache,
  composePromptMessages,
  getPromptTemplate,
  renderPrompt,
} from '@/domains/ai/prompts/service';
