import {
  AI_PURPOSE_TO_SETTING_KEY,
  AI_SETTING_KEY_VALUES,
  type AiPurposeName,
  type AiSettingKey,
} from '@gloaming/shared/llm';

export const AI_PURPOSE = AI_PURPOSE_TO_SETTING_KEY;
export type AiPurpose = AiPurposeName;
export const AI_SETTING_KEYS = AI_SETTING_KEY_VALUES;

export function settingKeyForPurpose(purpose: AiPurpose): AiSettingKey {
  return AI_PURPOSE[purpose];
}

export function isAiSettingKey(key: string): key is AiSettingKey {
  return (AI_SETTING_KEYS as readonly string[]).includes(key);
}
