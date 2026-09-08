import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { ttsConfig as ttsConfigTable } from '@gloaming/db';
import {
  DEFAULT_TTS_VOICES,
  type PutTtsConfigBody,
  type TestTtsBody,
  type TestTtsResult,
  TTS_PROVIDER_AZURE,
  TTS_VOICE_PRESETS,
  type TtsCachePayload,
  ttsCachePayloadSchema,
  type TtsConfigView,
  type TtsVoicePreset,
  type TtsVoiceRole,
} from '@gloaming/shared/tts';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors';
import { decryptApiKey, encryptApiKey, maskApiKey } from '@/lib/llm';
import { rootLogger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { synthesizeAzureTts } from '@/lib/tts';
import { recordTtsInvocation } from '@/modules/tts/log';

export const TTS_CONFIG_ID = 'default';

const ttsLogger = rootLogger.child({ module: 'Tts' });

/** 30 days — same horizon as bilingual translation cache. */
const TTS_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const TTS_OUTPUT_MIME = 'audio/mpeg';

type TtsConfigRow = typeof ttsConfigTable.$inferSelect;

export type SynthesizeTtsOptions = {
  text: string;
  voice?: string;
  role?: TtsVoiceRole;
  source: string;
  userId?: string;
  /** Skip Redis read/write (admin connectivity probe). */
  bypassCache?: boolean;
};

export type SynthesizeTtsResult = {
  audio: Buffer;
  mimeType: string;
  voice: string;
  wordTimings: Array<{
    text: string;
    audioOffsetMs: number;
    durationMs: number;
    textOffset: number;
  }>;
  cached: boolean;
};

function emptyConfigView(): TtsConfigView {
  return {
    configured: false,
    provider: TTS_PROVIDER_AZURE,
    region: '',
    isEnabled: false,
    apiKeySet: false,
    apiKeyMasked: null,
    defaultVoice: DEFAULT_TTS_VOICES.defaultVoice,
    usVoice: DEFAULT_TTS_VOICES.usVoice,
    ukVoice: DEFAULT_TTS_VOICES.ukVoice,
    updatedAt: null,
  };
}

function toConfigView(row: TtsConfigRow): TtsConfigView {
  let apiKeyMasked: string | null = null;
  try {
    apiKeyMasked = maskApiKey(decryptApiKey(row.apiKeyCiphertext));
  } catch {
    apiKeyMasked = '****';
  }
  return {
    configured: true,
    provider: TTS_PROVIDER_AZURE,
    region: row.region,
    isEnabled: row.isEnabled,
    apiKeySet: true,
    apiKeyMasked,
    defaultVoice: row.defaultVoice,
    usVoice: row.usVoice,
    ukVoice: row.ukVoice,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadConfigRow(): Promise<TtsConfigRow | null> {
  const rows = await db.select().from(ttsConfigTable).where(eq(ttsConfigTable.id, TTS_CONFIG_ID)).limit(1);
  return rows[0] ?? null;
}

function resolveVoice(row: TtsConfigRow, options: { voice?: string; role?: TtsVoiceRole }): string {
  if (options.voice?.trim()) {
    return options.voice.trim();
  }
  if (options.role === 'us') {
    return row.usVoice;
  }
  if (options.role === 'uk') {
    return row.ukVoice;
  }
  return row.defaultVoice;
}

function normalizeTtsText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function ttsCacheKey(normalizedText: string, voice: string, region: string): string {
  const digest = createHash('sha256')
    .update(`${normalizedText}\0${voice}\0${TTS_OUTPUT_MIME}\0${region}`, 'utf8')
    .digest('hex');
  return `gloaming:tts:v1:${digest}`;
}

async function readTtsCache(key: string): Promise<TtsCachePayload | null> {
  try {
    const raw = await getRedis().get(key);
    if (!raw) {
      return null;
    }
    const parsed = ttsCachePayloadSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      ttsLogger.warn({ key }, 'Invalid TTS cache payload; ignoring');
      return null;
    }
    return parsed.data;
  } catch (error) {
    ttsLogger.warn({ err: error, key }, 'Redis TTS cache read failed');
    return null;
  }
}

async function writeTtsCache(key: string, payload: TtsCachePayload): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(payload), 'EX', TTS_CACHE_TTL_SECONDS);
  } catch (error) {
    ttsLogger.warn({ err: error, key }, 'Redis TTS cache write failed');
  }
}

export function listVoicePresets(): TtsVoicePreset[] {
  return TTS_VOICE_PRESETS.map((preset) => ({ ...preset }));
}

export async function getConfig(): Promise<TtsConfigView> {
  const row = await loadConfigRow();
  return row ? toConfigView(row) : emptyConfigView();
}

export async function putConfig(body: PutTtsConfigBody): Promise<TtsConfigView> {
  const existing = await loadConfigRow();
  if (!existing && !body.apiKey?.trim()) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'API key is required for first-time TTS setup');
  }

  const apiKeyCiphertext = body.apiKey?.trim() ? encryptApiKey(body.apiKey.trim()) : existing!.apiKeyCiphertext;

  const [row] = await db
    .insert(ttsConfigTable)
    .values({
      id: TTS_CONFIG_ID,
      provider: TTS_PROVIDER_AZURE,
      region: body.region,
      apiKeyCiphertext,
      isEnabled: body.isEnabled,
      defaultVoice: body.defaultVoice,
      usVoice: body.usVoice,
      ukVoice: body.ukVoice,
    })
    .onConflictDoUpdate({
      target: ttsConfigTable.id,
      set: {
        region: body.region,
        apiKeyCiphertext,
        isEnabled: body.isEnabled,
        defaultVoice: body.defaultVoice,
        usVoice: body.usVoice,
        ukVoice: body.ukVoice,
      },
    })
    .returning();

  return toConfigView(row!);
}

/**
 * Global TTS entry for admin and future learner flows.
 * Loads dynamic config, resolves voice, then calls the Azure adapter (or Redis cache).
 */
export async function synthesizeTts(options: SynthesizeTtsOptions): Promise<SynthesizeTtsResult> {
  const row = await loadConfigRow();
  if (!row) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'TTS is not configured');
  }
  if (!row.isEnabled) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'TTS is disabled');
  }
  if (row.provider !== TTS_PROVIDER_AZURE) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'Unsupported TTS provider');
  }

  const text = normalizeTtsText(options.text);
  if (!text) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'TTS text is required');
  }

  let subscriptionKey: string;
  try {
    subscriptionKey = decryptApiKey(row.apiKeyCiphertext);
  } catch {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'TTS credentials are invalid');
  }

  const voice = resolveVoice(row, options);
  const cacheKey = ttsCacheKey(text, voice, row.region);
  const useCache = !options.bypassCache;

  if (useCache) {
    const cached = await readTtsCache(cacheKey);
    if (cached) {
      return {
        audio: Buffer.from(cached.audioBase64, 'base64'),
        mimeType: cached.mimeType,
        voice: cached.voice,
        wordTimings: cached.wordTimings,
        cached: true,
      };
    }
  }

  const synthesized = await synthesizeAzureTts({
    subscriptionKey,
    region: row.region,
    voice,
    text,
  });

  const result: SynthesizeTtsResult = {
    audio: synthesized.audio,
    mimeType: synthesized.mimeType,
    voice,
    wordTimings: synthesized.wordTimings,
    cached: false,
  };

  if (useCache) {
    await writeTtsCache(cacheKey, {
      mimeType: result.mimeType,
      voice: result.voice,
      audioBase64: result.audio.toString('base64'),
      wordTimings: result.wordTimings,
    });
  }

  return result;
}

export async function testTts(body: TestTtsBody, options: { userId?: string } = {}): Promise<TestTtsResult> {
  const started = Date.now();
  try {
    const result = await synthesizeTts({
      text: body.text,
      role: body.role,
      voice: body.voice,
      source: 'admin.tts_test',
      userId: options.userId,
      bypassCache: true,
    });
    const latencyMs = Date.now() - started;

    await recordTtsInvocation({
      status: 'success',
      source: 'admin.tts_test',
      userId: options.userId,
      voice: result.voice,
      role: body.role ?? null,
      textPreview: body.text,
      textLength: body.text.length,
      latencyMs,
      cached: false,
    });

    return {
      ok: true,
      latencyMs,
      voice: result.voice,
      mimeType: result.mimeType,
      audioBase64: result.audio.toString('base64'),
      wordTimings: result.wordTimings,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = error instanceof AppError ? String(error.statusCode) : '500';
    await recordTtsInvocation({
      status: 'failure',
      errorCode,
      errorMessage: message,
      source: 'admin.tts_test',
      userId: options.userId,
      voice: body.voice ?? null,
      role: body.role ?? null,
      textPreview: body.text,
      textLength: body.text.length,
      latencyMs,
      cached: null,
    });
    throw error;
  }
}
