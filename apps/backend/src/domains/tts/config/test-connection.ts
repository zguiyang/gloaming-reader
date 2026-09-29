import type { TestTtsBody, TestTtsResult } from '@gloaming/shared/tts';

import { recordTtsInvocation } from '@/domains/tts/log';
import { synthesizeInstanceTts } from '@/domains/tts/synthesis/service';
import { AppError } from '@/shared/errors/app-error';

export async function testTts(body: TestTtsBody, options: { auditActorUserId?: string } = {}): Promise<TestTtsResult> {
  const started = Date.now();
  try {
    const result = await synthesizeInstanceTts({
      text: body.text,
      role: body.role,
      voice: body.voice,
      source: 'admin.tts_test',
      bypassCache: true,
    });
    const latencyMs = Date.now() - started;

    await recordTtsInvocation({
      status: 'success',
      source: 'admin.tts_test',
      userId: options.auditActorUserId,
      voice: result.voice,
      role: body.role ?? null,
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
    const errorCode = error instanceof AppError ? String(error.statusCode) : '500';
    await recordTtsInvocation({
      status: 'failure',
      errorCode,
      source: 'admin.tts_test',
      userId: options.auditActorUserId,
      voice: body.voice ?? null,
      role: body.role ?? null,
      textLength: body.text.length,
      latencyMs,
      cached: null,
    });
    throw error;
  }
}
