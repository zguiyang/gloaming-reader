import { eq } from 'drizzle-orm';

import { llmAppSetting as llmAppSettingTable } from '@gloaming/db';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { type AiPurpose, settingKeyForPurpose } from '@/modules/ai/purposes';

export async function resolveModelRowId(options: { modelRowId?: string; purpose?: AiPurpose }): Promise<string> {
  if (options.modelRowId) {
    return options.modelRowId;
  }
  const purpose = options.purpose ?? 'assist';
  const key = settingKeyForPurpose(purpose);
  const rows = await db.select().from(llmAppSettingTable).where(eq(llmAppSettingTable.key, key)).limit(1);
  const value = rows[0]?.value;
  if (!value) {
    const label =
      purpose === 'assist'
        ? 'Assist'
        : purpose === 'translate'
          ? 'Translate'
          : purpose === 'metadata-enrich'
            ? 'Metadata enrich'
            : 'AI';
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.MODEL_NOT_CONFIGURED, { label });
  }
  return value;
}
