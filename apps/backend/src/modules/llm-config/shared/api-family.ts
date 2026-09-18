import { isLlmApiFamily, type LlmApiFamily } from '@gloaming/shared/llm';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';

export function parseApiFamily(value: string): LlmApiFamily {
  if (!isLlmApiFamily(value)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.LLM.UNKNOWN_API_FAMILY);
  }
  return value;
}
