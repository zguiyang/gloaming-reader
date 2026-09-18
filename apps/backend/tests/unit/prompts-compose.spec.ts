import { describe, expect, it } from 'vitest';

import {
  clearPromptTemplateCache,
  composePromptMessages,
  PROMPT_ROLE,
  PROMPT_SCENE,
  renderPrompt,
} from '@/lib/prompts';
import { resolveAssistToolsForAction } from '@/modules/assist/tools';

describe('prompt compose', () => {
  it('renders mustache optional blocks', async () => {
    clearPromptTemplateCache();
    const withNeighbor = await renderPrompt('scenes/assist-read/user', {
      selection: 'hello',
      neighbor: '…hello world…',
    });
    expect(withNeighbor).toContain('Selection:');
    expect(withNeighbor).toContain('hello');
    expect(withNeighbor).toContain('Nearby context');
    expect(withNeighbor).not.toContain('Learner question');
    expect(withNeighbor).not.toContain('No text selection');

    const withQuestion = await renderPrompt('scenes/assist-read/user', {
      selection: 'hello',
      question: 'What does this mean?',
    });
    expect(withQuestion).toContain('Learner question');
    expect(withQuestion).not.toContain('Nearby context');

    const partLevelPrompt = await renderPrompt('scenes/assist-read/user', {
      question: '这篇大意？',
      selectionNote: 'No text selection — answer for the reading part as a whole (use tools if you need the body).',
    });
    expect(partLevelPrompt).toContain('No text selection');
    expect(partLevelPrompt).toContain('Learner question');
    expect(partLevelPrompt).not.toContain('Selection:');
  });

  it('composes language-teacher + assist-read with refuse-and-steer scope', async () => {
    clearPromptTemplateCache();
    const messages = await composePromptMessages({
      roleId: PROMPT_ROLE.languageTeacher,
      sceneId: PROMPT_SCENE.assistRead,
      actionId: 'lookup',
      vars: {
        targetLanguage: 'English',
        replyLanguage: 'Chinese',
        workTitle: 'Sample',
        selection: 'orbit',
        neighbor: 'the planet orbit',
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
    const system = messages[0]!.content;
    expect(system).toContain('language teacher');
    expect(system).toContain('word card');
    expect(system).toContain('Sample');
    expect(system).toMatch(/refuse|Out of scope|only help/i);
    expect(system).not.toContain('Explain the selected text in clear Chinese');
    expect(system).toMatch(/Do not[\s\S]*grammar/i);
    expect(messages[1]!.content).toContain('orbit');
  });

  it('maps explain action to meaning template', async () => {
    clearPromptTemplateCache();
    const messages = await composePromptMessages({
      roleId: PROMPT_ROLE.languageTeacher,
      sceneId: PROMPT_SCENE.assistRead,
      actionId: 'explain',
      vars: {
        targetLanguage: 'English',
        replyLanguage: 'Chinese',
        workTitle: 'Sample',
        selection: 'a long sentence',
      },
    });
    expect(messages[0]!.content).toContain('meaning and structure');
    expect(messages[0]!.content).not.toContain('word card');
  });

  it('composes gist without selection', async () => {
    clearPromptTemplateCache();
    const messages = await composePromptMessages({
      roleId: PROMPT_ROLE.languageTeacher,
      sceneId: PROMPT_SCENE.assistRead,
      actionId: 'gist',
      vars: {
        targetLanguage: 'English',
        replyLanguage: 'Chinese',
        workTitle: 'Ocean',
        selectionNote: 'No text selection — answer for the reading part as a whole (use tools if you need the body).',
      },
    });
    expect(messages[0]!.content).toMatch(/gist|大意|summary/i);
    expect(messages[1]!.content).toContain('No text selection');
  });
});

describe('resolveAssistToolsForAction', () => {
  const part = { title: 'T', body: 'hello world hello' };

  it('gives lookup search only', () => {
    const tools = resolveAssistToolsForAction('lookup', part);
    expect(tools.map((t) => t.name)).toEqual(['search_part']);
  });

  it('gives meaning and gist slice and search', () => {
    expect(resolveAssistToolsForAction('meaning', part).map((t) => t.name)).toEqual(['get_part_slice', 'search_part']);
    expect(resolveAssistToolsForAction('gist', part).map((t) => t.name)).toEqual(['get_part_slice', 'search_part']);
  });
});
