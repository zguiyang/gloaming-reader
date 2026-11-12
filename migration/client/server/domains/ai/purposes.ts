import { AI_PURPOSE_TO_SETTING_KEY, type AiPurposeName, type AiSettingKey } from '@gloaming/shared/llm';

export const AI_PURPOSE = AI_PURPOSE_TO_SETTING_KEY;
export type AiPurpose = AiPurposeName;

export function settingKeyForPurpose(purpose: AiPurpose): AiSettingKey {
  return AI_PURPOSE[purpose];
}
