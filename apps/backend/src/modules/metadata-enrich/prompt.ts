import type { AiMessageInput } from '@/modules/ai';
import type { MetadataFieldId } from '@/modules/metadata-enrich/fields';
import { supportedLocalesLabel } from '@/modules/metadata-enrich/taxonomy-localized';

export const EXCERPT_MAX_CHARS = 2500;
export const TOC_TITLE_MAX = 15;

export type EnrichPromptInput = {
  title: string;
  author: string;
  language: string;
  existingTags: string[];
  /** Raw EPUB dc:subject strings — hints only; never copy LCSH verbatim into tags. */
  catalogSubjects?: string[];
  ruleDescription: string;
  excerpt: string;
  tocTitles: string[];
  /** Fields missing/weak that this run must fill — everything else is off-limits. */
  requiredFields: MetadataFieldId[];
};

const FIELD_LABEL: Record<MetadataFieldId, string> = {
  description: 'description',
  tags: 'tags',
  category: 'category',
  source: 'source',
};

/**
 * Single-book context only — global tag/category data lives in tools and is
 * fetched on demand, so prompt size stays constant per book (anti-bloat).
 * The required/complete split makes the one-shot fill task explicit: the model
 * knows exactly which fields to output and which are already settled.
 */
export function buildEnrichMessages(input: EnrichPromptInput): AiMessageInput[] {
  const required = input.requiredFields.map((id) => FIELD_LABEL[id]);
  const complete = (Object.keys(FIELD_LABEL) as MetadataFieldId[]).filter(
    (id) => id !== 'source' && !input.requiredFields.includes(id),
  );

  const system = [
    'You are a metadata assistant for an English-language reading app.',
    'Produce metadata ONLY from the provided book context. Do not invent plot facts for the description.',
    'Do not include spoilers in the description.',
    required.length > 0
      ? `Required fields to fill: ${required.join(', ')}. Every required field must be present in your output.`
      : null,
    complete.length > 0 ? `Already complete, do not output: ${complete.join(', ')}.` : null,
    `For tags and category: call list_existing_tags / list_categories first. Return { id, name, localizedNames } where localizedNames is [{ locale, name }] covering every supported locale (${supportedLocalesLabel()}). Use only those locale codes. id is the tool id to reuse, or null to create. name is a fallback label when a locale is omitted — do not invent translations for locales you cannot name.`,
    'description: 2-3 sentences in the book language only — do not localize the description.',
    `tags: up to 6 noun phrases with localizedNames for each supported locale (${supportedLocalesLabel()}) — never copy library catalog headings (LCSH) or strings with "--".`,
    `category: exactly one shelf/genre with localizedNames for each supported locale (${supportedLocalesLabel()}).`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const excerpt = input.excerpt.slice(0, EXCERPT_MAX_CHARS);
  const tocTitles = input.tocTitles.slice(0, TOC_TITLE_MAX);

  const context = [
    `Title: ${input.title}`,
    `Author: ${input.author || 'unknown'}`,
    `Language: ${input.language}`,
    input.existingTags.length > 0 ? `Existing tags: ${input.existingTags.join(', ')}` : null,
    input.catalogSubjects && input.catalogSubjects.length > 0
      ? `Ebook catalog subjects (hints only — do not copy verbatim): ${input.catalogSubjects.join('; ')}`
      : null,
    input.ruleDescription ? `Existing description: ${input.ruleDescription}` : null,
    '',
    '--- Excerpt (start of reading content) ---',
    excerpt || '(empty)',
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
