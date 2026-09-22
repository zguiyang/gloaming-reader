import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PromptTemplate } from '@langchain/core/prompts';

import { ASSIST_ACTION_TEMPLATE, type PromptRoleId, type PromptSceneId } from '@/domains/ai/prompts/ids';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Colocated `roles/` + `scenes/` in dev; `dist/prompts` after build copy. */
function promptsRoot(): string {
  if (existsSync(join(__dirname, 'roles'))) {
    return __dirname;
  }
  return join(__dirname, '../../prompts');
}

const templateCache = new Map<string, string>();

export type PromptVars = Record<string, string | number | boolean | undefined | null>;

/** Chat message shape for LLM gateways (keeps lib free of modules/ imports). */
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

/**
 * Load a raw Markdown prompt template by id (e.g. `roles/language-teacher`).
 */
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

/** Clear template cache (tests). */
export function clearPromptTemplateCache(): void {
  templateCache.clear();
}

/**
 * Render a Mustache prompt template with vars (LangChain mustache; no HTML escape).
 */
export async function renderPrompt(relativeId: string, vars: PromptVars): Promise<string> {
  const template = getPromptTemplate(relativeId);
  const prompt = PromptTemplate.fromTemplate(template, {
    templateFormat: 'mustache',
    validateTemplate: false,
  });
  return prompt.format(sanitizeVars(vars));
}

function sanitizeVars(vars: PromptVars): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    out[key] = value;
  }
  return out;
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

/**
 * Compose system + user messages: role + scene base + action → system; scene user → user.
 */
export async function composePromptMessages(input: ComposePromptInput): Promise<PromptMessage[]> {
  const { roleId, sceneId, actionId, vars } = input;
  const actionFile = actionTemplateName(sceneId, actionId);
  const renderedVars = sanitizeVars(vars);

  const [role, base, action, user] = await Promise.all([
    renderPrompt(`roles/${roleId}`, renderedVars),
    renderPrompt(`scenes/${sceneId}/base`, renderedVars),
    renderPrompt(`scenes/${sceneId}/actions/${actionFile}`, renderedVars),
    renderPrompt(`scenes/${sceneId}/user`, renderedVars),
  ]);

  const system = [role, base, action].filter(Boolean).join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
