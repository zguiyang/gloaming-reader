import { rootLogger } from '@/server/infra/logging/logger';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

const azureTtsLogger = rootLogger.child({ module: 'AzureTtsRest' });

export type AzureTtsWordTiming = {
  text: string;
  audioOffsetMs: number;
  durationMs: number;
  textOffset: number;
};

export type AzureTtsSynthesizeInput = {
  subscriptionKey: string;
  region: string;
  voice: string;
  text: string;
};

export type AzureTtsSynthesizeResult = {
  audio: Buffer;
  mimeType: string;
  wordTimings: AzureTtsWordTiming[];
};

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Azure Speech REST (SSML) — replaces the native Speech SDK (L5 / T2).
 * Word boundary timings are not returned by the short REST path; callers that need
 * timings should use the detail endpoint in a later slice.
 */
export async function synthesizeAzureTts(input: AzureTtsSynthesizeInput): Promise<AzureTtsSynthesizeResult> {
  const endpoint = `https://${input.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${escapeXml(input.voice)}'>${escapeXml(input.text)}</voice></speak>`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': input.subscriptionKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
      'User-Agent': 'gloaming-client',
    },
    body: ssml,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    azureTtsLogger.error({ status: response.status, detail: detail.slice(0, 500) }, 'Azure TTS REST failed');
    throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return {
    audio,
    mimeType: 'audio/mpeg',
    wordTimings: [],
  };
}
