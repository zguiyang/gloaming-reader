import { type Dispatcher, EnvHttpProxyAgent, fetch as undiciFetch, ProxyAgent } from 'undici';

/**
 * Outbound proxy strategy for LLM calls (per-client, never global):
 *
 * 1. Explicit `proxyUrl` from `llm_provider` — admin-configurable, wins.
 * 2. `EnvHttpProxyAgent` — honors `http_proxy` / `https_proxy` / `no_proxy`
 *    env vars, so local dev (e.g. `proxyon`) works with zero config.
 * 3. No proxy anywhere — plain direct connection (production default).
 *
 * The dispatcher is injected through a wrapped `fetch` passed to the OpenAI
 * client (`configuration.fetch`), keeping every other request in the process
 * on its normal network path. The wrapper uses undici's own fetch so the
 * dispatcher and the client come from the same implementation (the built-in
 * global fetch cannot run a differently-versioned npm undici dispatcher).
 */
export function buildProxiedFetch(proxyUrl: string | null): typeof fetch | undefined {
  if (
    !proxyUrl &&
    !process.env.http_proxy &&
    !process.env.https_proxy &&
    !process.env.HTTP_PROXY &&
    !process.env.HTTPS_PROXY
  ) {
    return undefined;
  }
  const dispatcher: Dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : new EnvHttpProxyAgent();
  const wrapped = (input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
    undiciFetch(input, { ...init, dispatcher });
  return wrapped as unknown as typeof fetch;
}
