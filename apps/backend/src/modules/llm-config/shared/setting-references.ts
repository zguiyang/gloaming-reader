import { inArray } from 'drizzle-orm';

import { llmAppSetting as llmAppSettingTable } from '@gloaming/db';

import { db } from '@/db';

export async function settingReferencesModel(modelIds: string[]): Promise<boolean> {
  if (modelIds.length === 0) {
    return false;
  }
  const rows = await db
    .select({ value: llmAppSettingTable.value })
    .from(llmAppSettingTable)
    .where(inArray(llmAppSettingTable.value, modelIds))
    .limit(1);
  return rows.length > 0;
}
