import { Hono } from 'hono';

import { aiRoutes } from '@/domains/ai';
import { assetManagementRoutes, assetsRoutes } from '@/domains/assets';
import { assistRoutes } from '@/domains/assist';
import { conversationsRoutes } from '@/domains/conversations';
import { dictionaryRoutes } from '@/domains/dictionary';
import { libraryRoutes } from '@/domains/library';
import { llmConfigRoutes } from '@/domains/llm';
import { readerRoutes, readingHistoryRoutes } from '@/domains/reading';
import { recommendationsRoutes } from '@/domains/recommendations';
import { translateRoutes } from '@/domains/translate';
import { ttsRoutes } from '@/domains/tts';
import { worksRoutes } from '@/domains/works/routes';
import { checkReadiness } from '@/infra/http/health';
import { type AuthVariables, requireAdmin, requireAuth } from '@/infra/http/middleware/auth';
import { enqueuePing } from '@/infra/queue';

/** Route composition entry — mount feature modules here as they are added. */
export const routes = new Hono<{ Variables: AuthVariables }>();

routes.get('/api/health/live', (c) => {
  return c.json({ status: 'live' });
});

routes.get('/api/health/ready', async (c) => {
  const result = await checkReadiness();
  return c.json(
    { status: result.ready ? 'ready' : 'not_ready', dependencies: result.dependencies },
    result.ready ? 200 : 503,
  );
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
routes.route('/', assetManagementRoutes);
routes.route('/', assetsRoutes);
routes.route('/', libraryRoutes);
routes.route('/', recommendationsRoutes);
routes.route('/', readerRoutes);
routes.route('/', readingHistoryRoutes);
routes.route('/', llmConfigRoutes);
routes.route('/', aiRoutes);
routes.route('/', assistRoutes);
routes.route('/', conversationsRoutes);
routes.route('/', translateRoutes);
routes.route('/', ttsRoutes);
routes.route('/', dictionaryRoutes);
