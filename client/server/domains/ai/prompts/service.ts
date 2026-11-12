import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASSIST_ACTION_TEMPLATE, type PromptRoleId, type PromptSceneId } from '@/server/domains/ai/prompts/ids';

const moduleDir = dirname(fileURLToPath(import.meta.url));

function promptsRoot(): string {
  if (existsSync(join(moduleDir, 'roles'))) {
    return moduleDir;
  }
  return join(moduleDir, '../../prompts');
}

const templateCache = new Map<string, string>();

export type PromptVars = Record<string, string | number | boolean | undefined | null>;

export type PromptMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ComposePromptInput = {
  roleId: PromptRoleId | string;
  sceneId: PromptSceneId | string;
  actionId: string;
  vars: PromptVars;
};

function templatePath(relativeId: string): string {
  const safe = relativeId.replace(/\\/g, '/').replace(/\.\./g, '');
  return join(promptsRoot(), `${safe}.md`);
}

export function getPromptTemplate(relativeId: string): string {
  const cached = templateCache.get(relativeId);
  if (cached !== undefined) {
    return cached;
  }
  const path = templatePath(relativeId);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Prompt template not found: ${relativeId} (${path})`);
  }
  const trimmed = raw.trim();
  templateCache.set(relativeId, trimmed);
  return trimmed;
}

export function clearPromptTemplateCache(): void {
  templateCache.clear();
}

function sanitizeVars(vars: PromptVars): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = String(value);
  }
  return out;
}

/** Mustache-lite `{{var}}` substitution (no LangChain). */
export async function renderPrompt(relativeId: string, vars: PromptVars): Promise<string> {
  const template = getPromptTemplate(relativeId);
  const sanitized = sanitizeVars(vars);
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => sanitized[key] ?? '');
}

function actionTemplateName(sceneId: string, actionId: string): string {
  if (sceneId === 'assist-read') {
    const mapped = ASSIST_ACTION_TEMPLATE[actionId];
    if (!mapped) {
      throw new Error(`Unknown assist action for prompts: ${actionId}`);
    }
    return mapped;
  }
  return actionId;
}

export async function composePromptMessages(input: ComposePromptInput): Promise<PromptMessage[]> {
  const { roleId, sceneId, actionId, vars } = input;
  const role = await renderPrompt(`roles/${roleId}`, vars);
  const base = await renderPrompt(`scenes/${sceneId}/base`, vars);
  const action = await renderPrompt(`scenes/${sceneId}/actions/${actionTemplateName(sceneId, actionId)}`, vars);
  const user = await renderPrompt(`scenes/${sceneId}/user`, vars);
  return [
    { role: 'system', content: [role, base, action].filter(Boolean).join('\n\n') },
    { role: 'user', content: user },
  ];
}
