import { and, eq, isNull } from 'drizzle-orm';

import {
  llmAppSetting as llmAppSettingTable,
  llmModel as llmModelTable,
  llmProvider as llmProviderTable,
  ttsConfig as ttsConfigTable,
} from '@gloaming/db';
import {
  type AiSettingKey,
  assertWireVariantForFamily,
  isLlmApiFamily,
  isRuntimeImplemented,
} from '@gloaming/shared/llm';
import { TTS_PROVIDER_AZURE } from '@gloaming/shared/tts';

import type { ProviderRuntimeActor } from '@/domains/provider-scope/types';
import { db } from '@/infra/db';
import { decryptApiKey } from '@/infra/llm';

export type TtsConfigRow = typeof ttsConfigTable.$inferSelect;

/**
 * Resolve a purpose binding user-first, skipping unavailable configuration before runtime starts.
 * Provider call failures happen later and are never handled here.
 */
export async function resolveScopedAppSettingValue(
  key: AiSettingKey,
  actor: ProviderRuntimeActor,
): Promise<string | null> {
  const candidates: string[] = [];
  if (actor.kind === 'authenticated') {
    const userRows = await db
      .select({ value: llmAppSettingTable.value })
      .from(llmAppSettingTable)
      .where(and(eq(llmAppSettingTable.key, key), eq(llmAppSettingTable.ownerUserId, actor.userId)))
      .limit(1);
    if (userRows[0]?.value) {
      candidates.push(userRows[0].value);
    }
  }

  const instanceRows = await db
    .select({ value: llmAppSettingTable.value })
    .from(llmAppSettingTable)
    .where(and(eq(llmAppSettingTable.key, key), isNull(llmAppSettingTable.ownerUserId)))
    .limit(1);
  if (instanceRows[0]?.value && !candidates.includes(instanceRows[0].value)) {
    candidates.push(instanceRows[0].value);
  }

  for (const modelId of candidates) {
    if (await isUsableLlmConfiguration(modelId, actor)) {
      return modelId;
    }
  }
  return null;
}

async function isUsableLlmConfiguration(modelId: string, actor: ProviderRuntimeActor): Promise<boolean> {
  const rows = await db
    .select({
      ownerUserId: llmProviderTable.ownerUserId,
      modelEnabled: llmModelTable.isEnabled,
      wireVariant: llmModelTable.wireVariant,
      providerEnabled: llmProviderTable.isEnabled,
      apiFamily: llmProviderTable.apiFamily,
      apiKeyCiphertext: llmProviderTable.apiKeyCiphertext,
    })
    .from(llmModelTable)
    .innerJoin(llmProviderTable, eq(llmModelTable.providerId, llmProviderTable.id))
    .where(eq(llmModelTable.id, modelId))
    .limit(1);
  const row = rows[0];
  if (!row || !row.modelEnabled || !row.providerEnabled) {
    return false;
  }
  if (row.ownerUserId !== null && (actor.kind !== 'authenticated' || row.ownerUserId !== actor.userId)) {
    return false;
  }
  if (!isLlmApiFamily(row.apiFamily) || !isRuntimeImplemented(row.apiFamily)) {
    return false;
  }
  try {
    assertWireVariantForFamily(row.apiFamily, row.wireVariant);
    return Boolean(decryptApiKey(row.apiKeyCiphertext).trim());
  } catch {
    return false;
  }
}

/**
 * TTS config row for synthesis. Authenticated: usable user row, then usable instance row.
 * Anonymous: usable instance row only. Validation happens before any upstream call.
 */
export async function resolveScopedTtsConfigRow(actor: ProviderRuntimeActor): Promise<TtsConfigRow | null> {
  const userRows =
    actor.kind === 'authenticated'
      ? await db.select().from(ttsConfigTable).where(eq(ttsConfigTable.ownerUserId, actor.userId)).limit(1)
      : [];
  const instanceRows = await db.select().from(ttsConfigTable).where(isNull(ttsConfigTable.ownerUserId)).limit(1);
  return selectUsableTtsConfig(userRows[0] ?? null, instanceRows[0] ?? null);
}

export function selectUsableTtsConfig(
  userRow: TtsConfigRow | null,
  instanceRow: TtsConfigRow | null,
): TtsConfigRow | null {
  if (userRow && isUsableTtsConfiguration(userRow)) {
    return userRow;
  }
  return instanceRow && isUsableTtsConfiguration(instanceRow) ? instanceRow : null;
}

function isUsableTtsConfiguration(row: TtsConfigRow): boolean {
  if (!row.isEnabled || row.provider !== TTS_PROVIDER_AZURE || !row.region.trim()) {
    return false;
  }
  try {
    return Boolean(decryptApiKey(row.apiKeyCiphertext).trim());
  } catch {
    return false;
  }
}

export async function loadInstanceTtsConfigRow(): Promise<TtsConfigRow | null> {
  const rows = await db.select().from(ttsConfigTable).where(isNull(ttsConfigTable.ownerUserId)).limit(1);
  return rows[0] ?? null;
}
