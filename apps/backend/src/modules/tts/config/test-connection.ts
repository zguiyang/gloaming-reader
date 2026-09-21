import type { TestTtsBody, TestTtsResult } from '@gloaming/shared/tts';

import { AppError } from '@/lib/errors/app-error';
import { recordTtsInvocation } from '@/modules/tts/log';
import { synthesizeTts } from '@/modules/tts/synthesis/service';

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
      // Admin connectivity probe always bypasses cache.
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
