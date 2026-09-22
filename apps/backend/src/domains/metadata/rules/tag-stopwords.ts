/** Tags that carry no signal on their own (filtered from rule and AI tag paths). */
export const TAG_STOPWORDS = new Set([
  'book',
  'books',
  'story',
  'stories',
  'novel',
  'novels',
  'fiction',
  'nonfiction',
  'english',
  'ebook',
  'reading',
  'library',
]);

export function isStopwordTag(value: string): boolean {
  return TAG_STOPWORDS.has(value.toLowerCase().trim());
}
