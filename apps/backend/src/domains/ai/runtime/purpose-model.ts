import { type AiPurpose, settingKeyForPurpose } from '@/domains/ai/purposes';
import {
  assertModelAccessibleForActor,
  resolveScopedAppSettingValue,
  runtimeActorFromUserId,
} from '@/domains/provider-scope';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

export async function resolveModelRowId(options: {
  modelRowId?: string;
  purpose?: AiPurpose;
  userId?: string;
}): Promise<string> {
  const actor = runtimeActorFromUserId(options.userId);

  if (options.modelRowId) {
    await assertModelAccessibleForActor(options.modelRowId, actor);
    return options.modelRowId;
  }

  const purpose = options.purpose ?? 'assist';
  const key = settingKeyForPurpose(purpose);
  const value = await resolveScopedAppSettingValue(key, actor);
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
