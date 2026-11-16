import { createLogger } from '@/server/infra/logging/logger';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

const azureTtsLogger = createLogger('AzureTtsRest');

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

/** Azure Speech regional endpoints are lowercase alphanumeric plus hyphens (`westus2`). */
const AZURE_REGION_PATTERN = /^[a-z0-9-]+$/i;
const AZURE_TTS_TIMEOUT_MS = 30_000;
const AZURE_TTS_MAX_BYTES = 32 * 1024 * 1024;

/**
 * `region` is interpolated into the request host, so an unvalidated value is an
 * SSRF primitive (`region = "10.0.0.1/"`). It is validated on write, but legacy
 * rows bypass that, hence the runtime guard.
 */
function buildAzureTtsEndpoint(region: string): string {
  if (!AZURE_REGION_PATTERN.test(region)) {
    azureTtsLogger.error({ region }, 'Refusing TTS request with invalid Azure region');
    throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.TTS.NOT_CONFIGURED);
  }
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

/** Stream the body so an oversized upstream response cannot exhaust memory. */
async function readBoundedBody(response: Response): Promise<Buffer> {
  const stream = response.body;
  if (!stream) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.length > AZURE_TTS_MAX_BYTES) {
      throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.TTS.SYNTHESIS_FAILED);
    }
    return fallback;
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AZURE_TTS_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.TTS.SYNTHESIS_FAILED);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Azure Speech REST (SSML) — replaces the native Speech SDK (L5 / T2).
 * Word boundary timings are not returned by the short REST path; callers that need
 * timings should use the detail endpoint in a later slice.
 */
export async function synthesizeAzureTts(input: AzureTtsSynthesizeInput): Promise<AzureTtsSynthesizeResult> {
  const endpoint = buildAzureTtsEndpoint(input.region);
  const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${escapeXml(input.voice)}'>${escapeXml(input.text)}</voice></speak>`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AZURE_TTS_TIMEOUT_MS);
  try {
    // Refuse redirects the same way LLM/dictionary outbound fetch does: a 3xx
    // Location could point at a private host even when `region` is validated.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': input.subscriptionKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
        'User-Agent': 'gloaming-client',
      },
      body: ssml,
      signal: controller.signal,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      azureTtsLogger.error({ status: response.status, region: input.region }, 'Azure TTS refused redirect');
      throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.OUTBOUND_URL.REDIRECT);
    }

    if (!response.ok) {
      const detail = (await readBoundedBody(response).catch(() => Buffer.alloc(0))).toString('utf8');
      azureTtsLogger.error({ status: response.status, detail: detail.slice(0, 500) }, 'Azure TTS REST failed');
      throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.TTS.SYNTHESIS_FAILED);
    }

    const audio = await readBoundedBody(response);
    return {
      audio,
      mimeType: 'audio/mpeg',
      wordTimings: [],
    };
  } catch (error) {
    if (controller.signal.aborted) {
      azureTtsLogger.error({ timeoutMs: AZURE_TTS_TIMEOUT_MS }, 'Azure TTS REST timed out');
      throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.TTS.SYNTHESIS_FAILED);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
