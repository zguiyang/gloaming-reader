/** Prompt role ids (persona files under `prompts/roles/`). */
export const PROMPT_ROLE = {
  languageTeacher: 'language-teacher',
} as const;

export type PromptRoleId = (typeof PROMPT_ROLE)[keyof typeof PROMPT_ROLE];

/** Prompt scene ids (directories under `prompts/scenes/`). */
export const PROMPT_SCENE = {
  assistRead: 'assist-read',
  translatePart: 'translate-part',
} as const;

export type PromptSceneId = (typeof PROMPT_SCENE)[keyof typeof PROMPT_SCENE];

/** Map assist API actionId → template filename under `scenes/assist-read/actions/`. */
export const ASSIST_ACTION_TEMPLATE: Record<string, string> = {
  lookup: 'lookup',
  meaning: 'meaning',
  explain: 'meaning',
  simpler: 'simpler',
  referent: 'referent',
  qa: 'qa',
  gist: 'gist',
};
