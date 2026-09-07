import { z } from 'zod';

export const TTS_PROVIDER_AZURE = 'azure' as const;

export const ttsVoiceRoleValues = ['us', 'uk'] as const;
export type TtsVoiceRole = (typeof ttsVoiceRoleValues)[number];

/**
 * Curated Neural voices for admin Select (Azure voice short names).
 * Labels are Chinese for ops UX; value remains the Azure voice id.
 */
export const TTS_VOICE_PRESETS = [
  { role: 'us' as const, voice: 'en-US-JennyNeural', label: '珍妮 · 美音 · 亲切助手女声' },
  { role: 'us' as const, voice: 'en-US-GuyNeural', label: '盖伊 · 美音 · 温暖男声' },
  { role: 'us' as const, voice: 'en-US-AriaNeural', label: '艾瑞娅 · 美音 · 专业叙事女声' },
  { role: 'uk' as const, voice: 'en-GB-SoniaNeural', label: '索尼娅 · 英音 · 沉稳女声' },
  { role: 'uk' as const, voice: 'en-GB-RyanNeural', label: '瑞恩 · 英音 · 轻松男声' },
  { role: 'uk' as const, voice: 'en-GB-LibbyNeural', label: '莉比 · 英音 · 清亮女声' },
] as const;

export const DEFAULT_TTS_VOICES = {
  defaultVoice: 'en-US-JennyNeural',
  usVoice: 'en-US-JennyNeural',
  ukVoice: 'en-GB-SoniaNeural',
} as const;

export const ttsVoicePresetSchema = z.object({
  role: z.enum(ttsVoiceRoleValues),
  voice: z.string().min(1),
  label: z.string().min(1),
});

export type TtsVoicePreset = z.infer<typeof ttsVoicePresetSchema>;

export const ttsConfigSchema = z.object({
  configured: z.boolean(),
  provider: z.literal(TTS_PROVIDER_AZURE),
  region: z.string(),
  isEnabled: z.boolean(),
  apiKeySet: z.boolean(),
  apiKeyMasked: z.string().nullable(),
  defaultVoice: z.string(),
  usVoice: z.string(),
  ukVoice: z.string(),
  updatedAt: z.union([z.string(), z.date()]).nullable(),
});

export type TtsConfigView = z.infer<typeof ttsConfigSchema>;

export const putTtsConfigBodySchema = z.object({
  region: z.string().trim().min(1).max(64),
  apiKey: z.string().min(1).max(2000).optional(),
  isEnabled: z.boolean(),
  defaultVoice: z.string().trim().min(1).max(120),
  usVoice: z.string().trim().min(1).max(120),
  ukVoice: z.string().trim().min(1).max(120),
});

export type PutTtsConfigBody = z.infer<typeof putTtsConfigBodySchema>;

export const testTtsBodySchema = z.object({
  text: z.string().trim().min(1).max(500),
  role: z.enum(ttsVoiceRoleValues).optional(),
  voice: z.string().trim().min(1).max(120).optional(),
});

export type TestTtsBody = z.infer<typeof testTtsBodySchema>;

export const ttsWordTimingSchema = z.object({
  text: z.string(),
  audioOffsetMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  textOffset: z.number().int().nonnegative(),
});

export type TtsWordTiming = z.infer<typeof ttsWordTimingSchema>;

export const testTtsResultSchema = z.object({
  ok: z.literal(true),
  latencyMs: z.number().int().nonnegative(),
  voice: z.string(),
  mimeType: z.string(),
  audioBase64: z.string().min(1),
  wordTimings: z.array(ttsWordTimingSchema).optional(),
});

export type TestTtsResult = z.infer<typeof testTtsResultSchema>;

/** Redis payload for successful TTS synthesis (30-day TTL). */
export const ttsCachePayloadSchema = z.object({
  mimeType: z.string().min(1),
  voice: z.string().min(1),
  audioBase64: z.string().min(1),
  wordTimings: z.array(ttsWordTimingSchema),
});

export type TtsCachePayload = z.infer<typeof ttsCachePayloadSchema>;
