import type { AiMessageInput } from '@/domains/ai';

export const EXCERPT_MAX_CHARS = 2500;
export const TOC_TITLE_MAX = 15;

export type EnrichPromptInput = {
  title: string;
  author: string;
  language: string;
  description: string;
  excerpt: string;
  tocTitles: string[];
};

export function buildEnrichMessages(input: EnrichPromptInput): AiMessageInput[] {
  const system = [
    'You are a metadata assistant for an English-language reading app.',
    'Write one concise, factual description using only the provided book context. Do not invent plot facts or include spoilers.',
    'Write in the book language.',
    'Return a JSON object with one string field named description.',
  ].join('\n');
  const tocTitles = input.tocTitles.slice(0, TOC_TITLE_MAX);
  const context = [
    `Title: ${input.title}`,
    `Author: ${input.author || 'unknown'}`,
    `Language: ${input.language}`,
    input.description ? `Existing description: ${input.description}` : null,
    '',
    '--- Excerpt (start of reading content) ---',
    input.excerpt.slice(0, EXCERPT_MAX_CHARS) || '(empty)',
    '--- End of excerpt ---',
    tocTitles.length > 0 ? `--- Table of contents ---\n${tocTitles.join('\n')}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: context },
  ];
}
