import * as cheerio from 'cheerio';

export type SplitSentence = {
  index: number;
  paragraphIndex: number;
  en: string;
};

function isHtmlBody(body: string): boolean {
  return /<[a-z][\s\S]*>/i.test(body);
}

function paragraphsFromHtml(html: string): { paragraphIndex: number; text: string }[] {
  const $ = cheerio.load(html, null, false);
  const result: { paragraphIndex: number; text: string }[] = [];

  const pElements = $('[data-p]');
  if (pElements.length > 0) {
    pElements.each((_, el) => {
      const $el = $(el);
      const pAttr = $el.attr('data-p');
      const paragraphIndex = pAttr !== undefined ? Number(pAttr) : result.length;
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (text) {
        result.push({ paragraphIndex, text });
      }
    });
    return result;
  }

  $('p, div, blockquote, h1, h2, h3, h4, h5, h6, li, section').each((idx, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) {
      result.push({ paragraphIndex: idx, text });
    }
  });

  return result;
}

function paragraphsFromPlainText(body: string): { paragraphIndex: number; text: string }[] {
  const trimmed = body.replace(/\r\n/g, '\n').trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text, paragraphIndex) => ({ paragraphIndex, text }));
}

function splitParagraphSentences(paragraph: string): string[] {
  const text = paragraph.trim();
  if (!text) {
    return [];
  }

  const dotToken = '<<DOT>>';
  const protectedText = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|U\.S|U\.K)\./gi, (match) => match.replace(/\./g, dotToken))
    .replace(/(\d)\.(\d)/g, `$1${dotToken}$2`);

  const rawParts = protectedText.split(/(?<=[.!?])\s+(?=["'“‘([A-Z0-9])/);
  const sentences = rawParts.map((part) => part.split(dotToken).join('.').trim()).filter(Boolean);

  return sentences.length > 0 ? sentences : [text];
}

/** Sentence-split part body; indices are global across paragraphs. */
export function splitPartSentences(body: string): SplitSentence[] {
  const paragraphs = isHtmlBody(body) ? paragraphsFromHtml(body) : paragraphsFromPlainText(body);
  const sentences: SplitSentence[] = [];
  let index = 0;
  for (const { paragraphIndex, text } of paragraphs) {
    for (const en of splitParagraphSentences(text)) {
      sentences.push({ index, paragraphIndex, en });
      index += 1;
    }
  }
  return sentences;
}

export function formatSentenceListForPrompt(sentences: SplitSentence[]): string {
  return sentences.map((item) => `${item.index}\t${item.en}`).join('\n');
}

export type ParsedTranslateLine = { kind: 'title'; zh: string } | { kind: 'sentence'; index: number; zh: string };

export function parseTranslateOutputLine(line: string): ParsedTranslateLine | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const tab = trimmed.indexOf('\t');
  if (tab < 0) {
    return null;
  }
  const head = trimmed.slice(0, tab).trim();
  const zh = trimmed.slice(tab + 1).trim();
  if (!zh) {
    return null;
  }
  if (head.toUpperCase() === 'TITLE') {
    return { kind: 'title', zh };
  }
  if (/^\d+$/.test(head)) {
    return { kind: 'sentence', index: Number(head), zh };
  }
  return null;
}

export function createTranslateLineParser(): {
  push: (chunk: string) => ParsedTranslateLine[];
  flush: () => ParsedTranslateLine[];
} {
  let buffer = '';

  function consumeCompleteLines(flushRemainder: boolean): ParsedTranslateLine[] {
    const out: ParsedTranslateLine[] = [];
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        break;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const parsed = parseTranslateOutputLine(line);
      if (parsed) {
        out.push(parsed);
      }
    }
    if (flushRemainder && buffer.trim()) {
      const parsed = parseTranslateOutputLine(buffer);
      buffer = '';
      if (parsed) {
        out.push(parsed);
      }
    } else if (flushRemainder) {
      buffer = '';
    }
    return out;
  }

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, '\n');
      return consumeCompleteLines(false);
    },
    flush() {
      return consumeCompleteLines(true);
    },
  };
}
