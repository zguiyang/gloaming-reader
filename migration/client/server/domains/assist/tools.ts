import { z } from 'zod';

import type { AssistAskBody } from '@gloaming/shared/assist';

import type { AiToolHandle } from '@/server/domains/ai/runtime/types';
import { lookupWord } from '@/server/domains/dictionary';
import { anonymousWorkReadActor, type WorkReadActor } from '@/server/domains/works/access';

const SLICE_MAX = 2000;

type PartRef = {
  title: string;
  body: string;
  workId?: string;
  partId?: string;
};

function createDictionaryLookupTool(actor: WorkReadActor, part?: PartRef): AiToolHandle {
  return {
    name: 'dictionary_lookup',
    description:
      'Lookup standard definitions, phonetics, parts of speech, and contextual examples for an English word.',
    inputSchema: z.object({
      word: z.string().min(1).max(100).describe('The English word to lookup'),
      contextSentence: z.string().optional().describe('The sentence where the word appears for contextual meaning'),
    }),
    async execute(input) {
      const { word, contextSentence } = input as { word: string; contextSentence?: string };
      try {
        const entry = await lookupWord({
          actor,
          word,
          contextSentence,
          workId: part?.workId,
          partId: part?.partId,
        });
        if (!entry) {
          return { found: false, message: `No dictionary entry found for "${word}"` };
        }
        return { found: true, entry };
      } catch (err) {
        return { found: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

function createGetPartSliceTool(part: PartRef): AiToolHandle {
  return {
    name: 'get_part_slice',
    description:
      'Read a slice of the current reading part body by character offset and length. Use when nearby context is not enough for meaning, structure, or referents.',
    inputSchema: z.object({
      offset: z.number().int().min(0).describe('0-based character offset'),
      length: z.number().int().min(1).max(SLICE_MAX).describe('Max characters to return'),
    }),
    async execute(input) {
      const { offset, length } = input as { offset: number; length: number };
      const start = Math.max(0, Math.min(offset, part.body.length));
      const size = Math.max(1, Math.min(length, SLICE_MAX));
      const text = part.body.slice(start, start + size);
      return { offset: start, length: text.length, text };
    },
  };
}

function createSearchPartTool(part: PartRef): AiToolHandle {
  return {
    name: 'search_part',
    description:
      'Search the current reading part body for a keyword and return nearby excerpts. Use for word-card examples or to locate related sentences.',
    inputSchema: z.object({
      query: z.string().min(1).max(100),
      window: z.number().int().min(20).max(200).optional(),
    }),
    async execute(input) {
      const { query, window } = input as { query: string; window?: number };
      const q = query.trim().toLowerCase();
      if (!q) {
        return { matches: [] as { index: number; excerpt: string }[] };
      }
      const win = Math.min(Math.max(window ?? 80, 20), 200);
      const lower = part.body.toLowerCase();
      const matches: { index: number; excerpt: string }[] = [];
      let from = 0;
      while (matches.length < 5) {
        const index = lower.indexOf(q, from);
        if (index < 0) {
          break;
        }
        const start = Math.max(0, index - win);
        const end = Math.min(part.body.length, index + q.length + win);
        matches.push({ index, excerpt: part.body.slice(start, end) });
        from = index + q.length;
      }
      return { title: part.title, matches };
    },
  };
}

export function createPartAssistTools(actor: WorkReadActor, part: PartRef): AiToolHandle[] {
  return [createGetPartSliceTool(part), createSearchPartTool(part), createDictionaryLookupTool(actor, part)];
}

export function resolveAssistToolsForAction(
  actionId: AssistAskBody['actionId'],
  part: PartRef,
  _actor: WorkReadActor = anonymousWorkReadActor(),
): AiToolHandle[] {
  const search = createSearchPartTool(part);
  if (actionId === 'lookup') {
    return [search];
  }
  return [createGetPartSliceTool(part), search];
}
