import { isLlmApiFamily, type LlmApiFamily } from '@gloaming/shared/llm';

import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export function parseApiFamily(value: string): LlmApiFamily {
  if (!isLlmApiFamily(value)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.UNKNOWN_API_FAMILY);
  }
  return value;
}
