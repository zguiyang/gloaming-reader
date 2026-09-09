import { Hono } from 'hono';

import { enqueuePing } from '@/lib/queue';
import { redisPing } from '@/lib/redis';
import { type AuthVariables, requireAdmin, requireAuth } from '@/middleware/auth';
import { aiRoutes } from '@/modules/ai/route';
import { assetManagementRoutes } from '@/modules/asset-management/route';
import { assetsRoutes } from '@/modules/assets/route';
import { assistRoutes } from '@/modules/assist/route';
import { contentAssetsRoutes } from '@/modules/content-assets/route';
import { conversationsRoutes } from '@/modules/conversations/route';
import { dictionaryRoutes } from '@/modules/dictionary/route';
import { llmConfigRoutes } from '@/modules/llm-config/route';
import { readerRoutes } from '@/modules/reader/route';
import { readingHistoryRoutes } from '@/modules/reading-history/route';
import { recommendationsRoutes } from '@/modules/recommendations/route';
import { shelfRoutes } from '@/modules/shelf/route';
import { taxonomyRoutes } from '@/modules/taxonomy/route';
import { translateRoutes } from '@/modules/translate/route';
import { ttsRoutes } from '@/modules/tts/route';
import { worksRoutes } from '@/modules/works/route';

/** Route composition entry — mount feature modules here as they are added. */
export const routes = new Hono<{ Variables: AuthVariables }>();

routes.get('/api/health', async (c) => {
  const redis = await redisPing();
  return c.json({ ok: true, redis });
});

routes.get('/api/me', requireAuth, (c) => {
  return c.json(c.get('user'));
});

routes.get('/api/admin/probe', requireAdmin, (c) => {
  return c.json({ role: c.get('user')?.role });
});

routes.post('/api/admin/jobs/ping', requireAdmin, async (c) => {
  const id = await enqueuePing();
  return c.json({ id });
});

routes.route('/', worksRoutes);
routes.route('/', contentAssetsRoutes);
routes.route('/', assetManagementRoutes);
routes.route('/', assetsRoutes);
routes.route('/', shelfRoutes);
routes.route('/', recommendationsRoutes);
routes.route('/', taxonomyRoutes);
routes.route('/', readerRoutes);
routes.route('/', readingHistoryRoutes);
routes.route('/', llmConfigRoutes);
routes.route('/', aiRoutes);
routes.route('/', assistRoutes);
routes.route('/', conversationsRoutes);
routes.route('/', translateRoutes);
routes.route('/', ttsRoutes);
routes.route('/', dictionaryRoutes);
