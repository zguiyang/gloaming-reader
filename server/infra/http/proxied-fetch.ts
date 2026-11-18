import { type Dispatcher, EnvHttpProxyAgent, fetch as undiciFetch, ProxyAgent } from 'undici';

/**
 * Outbound HTTP(S) proxy for server-side fetches (per-call, never global).
 *
 * Priority:
 * 1. Explicit `proxyUrl` (channel/admin/env) — wins when non-empty.
 * 2. `EnvHttpProxyAgent` — honors `http_proxy` / `https_proxy` / `no_proxy`
 *    (and uppercase variants) so local `proxyon`-style setups work with zero
 *    channel config.
 * 3. Neither — return `undefined` so the caller uses the platform `fetch`
 *    (production default: direct).
 *
 * Uses undici's own `fetch` when a dispatcher is required so the ProxyAgent and
 * the client share one undici implementation (Node's global fetch cannot run a
 * differently-versioned npm undici dispatcher).
 */
export function buildProxiedFetch(proxyUrl: string | null | undefined): typeof fetch | undefined {
  const explicit = normalizeProxyUrl(proxyUrl);
  if (
    !explicit &&
    !process.env.http_proxy &&
    !process.env.https_proxy &&
    !process.env.HTTP_PROXY &&
    !process.env.HTTPS_PROXY
  ) {
    return undefined;
  }

  const dispatcher: Dispatcher = explicit ? new ProxyAgent(explicit) : new EnvHttpProxyAgent();
  const wrapped = (input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
    undiciFetch(input, { ...init, dispatcher });
  return wrapped as unknown as typeof fetch;
}

/**
 * Resolve the fetch implementation for one outbound call.
 * Falls back to the platform `fetch` when no proxy applies.
 */
export function resolveOutboundFetch(proxyUrl: string | null | undefined): typeof fetch {
  return buildProxiedFetch(proxyUrl) ?? globalThis.fetch.bind(globalThis);
}

/**
 * First non-empty env value among `keys` (trimmed). Does not fall through to
 * `http_proxy` / `https_proxy` — those are handled inside {@link buildProxiedFetch}.
 */
export function resolveProxyUrlFromEnv(...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return normalizeProxyUrl(value) ?? value;
    }
  }
  return null;
}

/**
 * Ops / channel proxies may point at localhost (Clash, etc.). Only enforce
 * http(s) scheme; leave SSRF hardening to admin-facing URL validators.
 */
export function normalizeProxyUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('proxy URL must be a valid absolute http(s) URI');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('proxy URL must use http:// or https:// (SOCKS is not supported)');
  }
  return trimmed;
}
