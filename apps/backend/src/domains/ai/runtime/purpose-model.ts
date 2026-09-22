import { eq } from 'drizzle-orm';

import { llmAppSetting as llmAppSettingTable } from '@gloaming/db';

import { type AiPurpose, settingKeyForPurpose } from '@/domains/ai/purposes';
import { db } from '@/infra/db';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

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
