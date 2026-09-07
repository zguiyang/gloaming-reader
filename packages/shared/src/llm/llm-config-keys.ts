/** Whitelisted llm_app_setting keys (purpose → default model row id). */
export const AI_SETTING_KEY_VALUES = [
  'assist.default_model_id',
  'translate.default_model_id',
  'metadata-enrich.default_model_id',
] as const;

export type AiSettingKey = (typeof AI_SETTING_KEY_VALUES)[number];

export const AI_PURPOSE_TO_SETTING_KEY = {
  assist: 'assist.default_model_id',
  translate: 'translate.default_model_id',
  'metadata-enrich': 'metadata-enrich.default_model_id',
} as const satisfies Record<string, AiSettingKey>;

export type AiPurposeName = keyof typeof AI_PURPOSE_TO_SETTING_KEY;
