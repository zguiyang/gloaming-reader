import { decodeHTMLStrict } from 'entities';

import { AZURE_TTS_RISK_SYMBOL_RULES } from './azure-risk-symbol-rules.ts';

/** Bump when risk-symbol, NFKC, control-char, whitespace, or entity normalization rules change (cache digest input). */
export const TTS_INPUT_NORMALIZATION_VERSION = 3 as const;

const RESIDUAL_ENTITY_PATTERN = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

const RESIDUAL_ENTITY_GLOBAL = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

/** One-pass strict HTML entity decode for a single `&...;` token (no recursive re-decode). */
function decodeHtmlEntityToken(token: string): string {
  return decodeHTMLStrict(token);
}

/**
 * Decode residual entities only when the plain text still contains `&...;` tokens.
 * Does not re-decode plain ampersands that Cheerio already expanded.
 */
function decodeResidualHtmlEntitiesIfNeeded(text: string): string {
  if (!RESIDUAL_ENTITY_PATTERN.test(text)) {
    return text;
  }
  return text.replace(RESIDUAL_ENTITY_GLOBAL, (match) => decodeHtmlEntityToken(match));
}

function isZeroWidthOrInvisibleControl(codePoint: number): boolean {
  if (
    codePoint === 0x200b ||
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    codePoint === 0xfeff ||
    codePoint === 0x2060
  ) {
    return true;
  }
  if (codePoint <= 0x1f) {
    return codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d;
  }
  if (codePoint >= 0x7f && codePoint <= 0x9f) {
    return true;
  }
  return false;
}

/** Same whitespace rules as `normalizePartAudioWhitespace` / `buildPartAudioText` (part-audio offset SSOT). */
export function normalizeTtsSourceWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export type TtsInputNormalization = {
  /** Canonical plain text for offsets / display alignment (no Azure risk replacements). */
  sourceText: string;
  /** Text passed to Azure TTS. */
  ttsText: string;
  /** Map a UTF-16 index in `ttsText` to the corresponding index in `sourceText`. */
  mapTtsOffsetToSource: (ttsOffset: number) => number;
};

function appendTtsCodeUnit(
  ch: string,
  sourceIndex: number,
  ttsChars: string[],
  ttsToSource: number[],
  ruleByChar: Map<string, string>,
): void {
  const spoken = ruleByChar.get(ch);
  if (spoken) {
    for (let k = 0; k < spoken.length; k += 1) {
      ttsChars.push(spoken[k]!);
      ttsToSource.push(sourceIndex);
    }
    return;
  }
  ttsChars.push(ch);
  ttsToSource.push(sourceIndex);
}

function buildTtsTextWithMapping(sourceText: string): { ttsText: string; ttsToSource: number[] } {
  const ruleByChar = new Map(AZURE_TTS_RISK_SYMBOL_RULES.map((rule) => [rule.source, rule.spoken]));
  const ttsChars: string[] = [];
  const ttsToSource: number[] = [];

  for (let i = 0; i < sourceText.length;) {
    const codePoint = sourceText.codePointAt(i)!;
    const unitLength = codePoint > 0xffff ? 2 : 1;
    const sourceIndex = i;

    if (!isZeroWidthOrInvisibleControl(codePoint)) {
      const nfkc = String.fromCodePoint(codePoint).normalize('NFKC');
      for (let j = 0; j < nfkc.length; j += 1) {
        appendTtsCodeUnit(nfkc[j]!, sourceIndex, ttsChars, ttsToSource, ruleByChar);
      }
    }

    i += unitLength;
  }

  return { ttsText: ttsChars.join(''), ttsToSource };
}

/**
 * Single entry: plain reading text → source + TTS synth strings with offset mapping.
 * Does not parse HTML; callers use the existing Cheerio plain-text pipeline first.
 */
export function normalizeTtsInput(plainText: string): TtsInputNormalization {
  const withEntities = decodeResidualHtmlEntitiesIfNeeded(plainText);
  const sourceText = normalizeTtsSourceWhitespace(withEntities);
  const { ttsText, ttsToSource } = buildTtsTextWithMapping(sourceText);

  const mapTtsOffsetToSource = (ttsOffset: number): number => {
    if (!Number.isFinite(ttsOffset) || ttsOffset <= 0) {
      return 0;
    }
    if (ttsToSource.length === 0) {
      return 0;
    }
    if (ttsOffset >= ttsToSource.length) {
      return sourceText.length;
    }
    return ttsToSource[Math.floor(ttsOffset)] ?? sourceText.length;
  };

  return { sourceText, ttsText, mapTtsOffsetToSource };
}
