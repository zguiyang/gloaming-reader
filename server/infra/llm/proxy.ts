/**
 * LLM-facing re-export of the shared outbound proxied fetch helper.
 * Prefer `@/server/infra/http` for new non-LLM callers.
 */
export { buildProxiedFetch } from '@/server/infra/http/proxied-fetch';
