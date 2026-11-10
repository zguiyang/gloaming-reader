/**
 * Azure Speech word-boundary events break on a small set of literal symbols.
 * Rules are data-driven so replacements can change without scattering conditionals.
 */
export type AzureTtsRiskSymbolRule = {
  /** Single source character to replace in TTS synth text only. */
  source: string;
  /** Spoken / safe substitute sent to Azure (may be multi-character). */
  spoken: string;
};

export const AZURE_TTS_RISK_SYMBOL_RULES: readonly AzureTtsRiskSymbolRule[] = [
  { source: '&', spoken: ' and ' },
  { source: '<', spoken: ' less than ' },
  { source: '>', spoken: ' greater than ' },
];
