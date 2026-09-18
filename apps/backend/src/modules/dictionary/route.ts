import { Hono } from 'hono';

import { HTTP_STATUS } from '@/constants';
import { ERROR_CODES } from '@/lib/errors/codes';
import { sendError } from '@/lib/response';
import { type AuthVariables, requireAdmin } from '@/middleware/auth';
import { rateLimit } from '@/middleware/rate-limit';
import * as dictionaryService from '@/modules/dictionary/service';
import {
  validateLookupDictionaryQuery,
  validatePutDictionaryConfig,
  validateTestDictionary,
} from '@/modules/dictionary/validator';

export const dictionaryRoutes = new Hono<{ Variables: AuthVariables }>();

// Admin Config
dictionaryRoutes.get('/api/admin/dictionary/config', requireAdmin, async (c) => {
  return c.json(await dictionaryService.getDictionaryConfig());
});

dictionaryRoutes.put('/api/admin/dictionary/config', requireAdmin, validatePutDictionaryConfig, async (c) => {
  return c.json(await dictionaryService.putDictionaryConfig(c.req.valid('json')));
});

dictionaryRoutes.post('/api/admin/dictionary/test', requireAdmin, validateTestDictionary, async (c) => {
  return c.json(await dictionaryService.testDictionary(c.req.valid('json')));
});

// Public / Reader Lookup (open to guests and authenticated users)
dictionaryRoutes.get(
  '/api/dictionary/lookup',
  rateLimit('dictionaryLookup'),
  validateLookupDictionaryQuery,
  async (c) => {
    const query = c.req.valid('query');
    const entry = await dictionaryService.lookupWord({
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
