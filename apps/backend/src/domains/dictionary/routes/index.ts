import { Hono } from 'hono';

import { getDictionaryConfig, putDictionaryConfig } from '@/domains/dictionary/config/service';
import { lookupWord, testDictionary } from '@/domains/dictionary/lookup/index';
import {
  validateLookupDictionaryQuery,
  validatePutDictionaryConfig,
  validateTestDictionary,
} from '@/domains/dictionary/validator';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';
import { rateLimit } from '@/infra/http/middleware/rate-limit';
import { sendError } from '@/infra/http/response';
import { HTTP_STATUS } from '@/shared/constants';
import { ERROR_CODES } from '@/shared/errors/codes';

export const dictionaryRoutes = new Hono<{ Variables: AuthVariables }>();

// Admin Config
dictionaryRoutes.get('/api/admin/dictionary/config', requireAdmin, async (c) => {
  return c.json(await getDictionaryConfig());
});

dictionaryRoutes.put('/api/admin/dictionary/config', requireAdmin, validatePutDictionaryConfig, async (c) => {
  return c.json(await putDictionaryConfig(c.req.valid('json')));
});

dictionaryRoutes.post('/api/admin/dictionary/test', requireAdmin, validateTestDictionary, async (c) => {
  return c.json(await testDictionary(c.req.valid('json')));
});

// Public / Reader Lookup (open to guests and authenticated users)
dictionaryRoutes.get(
  '/api/dictionary/lookup',
  rateLimit('dictionaryLookup'),
  validateLookupDictionaryQuery,
  async (c) => {
    const query = c.req.valid('query');
    const entry = await lookupWord({
      word: query.word,
      contextSentence: query.contextSentence,
      workId: query.workId,
      partId: query.partId,
    });

    if (!entry) {
      return sendError(c, ERROR_CODES.NOT_FOUND.WORD_DEFINITION, HTTP_STATUS.NOT_FOUND, { word: query.word });
    }

    return c.json({ ok: true, entry });
  },
);
