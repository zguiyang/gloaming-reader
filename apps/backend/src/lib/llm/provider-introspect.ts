import type { llmProvider as llmProviderTable } from '@gloaming/db';
import type { ProviderBalanceResult, ProviderModelCandidate } from '@gloaming/shared/llm';
import { getWireFamilyDefinition, isLlmApiFamily } from '@gloaming/shared/llm';

import { resolveProviderBalanceUrl } from '@/lib/llm/outbound-url';
import { buildProxiedFetch } from '@/lib/llm/proxy';

type ProviderRow = typeof llmProviderTable.$inferSelect;

const REQUEST_TIMEOUT_MS = 10_000;

class UpstreamRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

async function requestJson(url: string, apiKey: string, proxyUrl: string | null): Promise<unknown> {
  const proxiedFetch = buildProxiedFetch(proxyUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (proxiedFetch ?? fetch)(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new UpstreamRequestError(aborted ? '请求超时' : '网络请求失败');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new UpstreamRequestError(`HTTP ${response.status}`, response.status);
  }
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new UpstreamRequestError('响应不是合法 JSON');
  }
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolvePath(root: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let current: unknown = root;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Resolve an amount expression. Supports plain JSON paths (e.g. `data.balance`)
 * and two-path subtraction (e.g. `data.total_credits - data.total_usage`).
 */
function resolveExpression(root: unknown, path: string): number | null {
  const trimmed = path.trim();
  if (trimmed.includes(' - ')) {
    const [left, right] = trimmed.split(' - ').map((part) => part.trim());
    if (right) {
      const a = asFiniteNumber(resolvePath(root, left));
      const b = asFiniteNumber(resolvePath(root, right));
      return a != null && b != null ? a - b : null;
    }
  }
  return asFiniteNumber(resolvePath(root, trimmed));
}

function pickFirst(root: unknown, candidates: string[]): unknown {
  for (const path of candidates) {
    const value = resolvePath(root, path);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

/**
 * Fetch the live model list from an OpenAI-compatible `GET /models` endpoint.
 * Handles both `https://host/v1` and root-host base URLs; parses the richer
 * OpenRouter-style fields when present (context length, pricing, etc.).
 */
export async function fetchProviderModelCandidates(
  row: ProviderRow,
  apiKey: string,
): Promise<ProviderModelCandidate[]> {
  if (!isLlmApiFamily(row.apiFamily)) {
    throw new UpstreamRequestError('服务商 API 协议族无效');
  }
  const familyDef = getWireFamilyDefinition(row.apiFamily);
  if (!familyDef.provider.capabilities.modelList) {
    throw new UpstreamRequestError('当前 API 协议族不支持拉取模型列表');
  }

  const base = row.baseUrl.replace(/\/+$/, '');
  const candidates: string[] = base.endsWith('/v1') ? [`${base}/models`] : [`${base}/models`, `${base}/v1/models`];

  let payload: unknown;
  let resolved = false;
  for (const url of candidates) {
    try {
      payload = await requestJson(url, apiKey, row.proxyUrl);
      resolved = true;
      break;
    } catch (error) {
      const upstream = error instanceof UpstreamRequestError ? error : null;
      if (upstream?.status === 404 && !url.endsWith('/v1/models')) {
        continue;
      }
      throw upstream ?? error;
    }
  }
  if (!resolved) {
    throw new UpstreamRequestError('无法访问模型列表端点');
  }

  const data = isRecord(payload) ? payload.data : undefined;
  if (!Array.isArray(data)) {
    throw new UpstreamRequestError('响应缺少 data 数组');
  }

  const models: ProviderModelCandidate[] = [];
  for (const item of data) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) {
      continue;
    }
    const topProvider = isRecord(item.top_provider) ? item.top_provider : null;
    const pricing = isRecord(item.pricing) ? item.pricing : null;
    models.push({
      id: item.id,
      label: typeof item.name === 'string' && item.name.trim() ? item.name : item.id,
      ownedBy: typeof item.owned_by === 'string' ? item.owned_by : null,
      contextLength: asFiniteNumber(item.context_length),
      maxOutputTokens: asFiniteNumber(topProvider?.max_completion_tokens ?? item.max_output_tokens),
      pricing:
        pricing && (typeof pricing.prompt === 'string' || typeof pricing.completion === 'string')
          ? { prompt: String(pricing.prompt ?? ''), completion: String(pricing.completion ?? '') }
          : null,
      description: typeof item.description === 'string' ? item.description : null,
    });
  }
  return models;
}

/**
 * Query the provider's balance endpoint configured on the provider row.
 * Returns a discriminated result; never throws for upstream failures.
 */
export async function queryProviderBalance(row: ProviderRow, apiKey: string): Promise<ProviderBalanceResult> {
  if (!isLlmApiFamily(row.apiFamily)) {
    return { supported: false, reason: 'invalid-config', message: '服务商 API 协议族无效' };
  }
  const familyDef = getWireFamilyDefinition(row.apiFamily);
  if (!familyDef.provider.capabilities.balanceQuery) {
    return { supported: false, reason: 'not-configured', message: '当前 API 协议族不支持余额查询' };
  }
  if (!row.balanceEndpoint) {
    return { supported: false, reason: 'not-configured', message: '未配置余额查询端点' };
  }
  if (!row.balanceAmountPath) {
    return { supported: false, reason: 'invalid-config', message: '未配置余额字段路径' };
  }

  let url: string;
  try {
    url = resolveProviderBalanceUrl(row.baseUrl, row.balanceEndpoint);
  } catch (error) {
    return {
      supported: false,
      reason: 'invalid-config',
      message: error instanceof Error ? error.message : '余额端点无效',
    };
  }

  let payload: unknown;
  try {
    payload = await requestJson(url, apiKey, row.proxyUrl);
  } catch (error) {
    const upstream = error instanceof UpstreamRequestError ? error : null;
    if (upstream?.status === 401 || upstream?.status === 403) {
      return { supported: false, reason: 'auth-failed', message: '鉴权失败，请检查 API Key 是否有余额查询权限' };
    }
    return {
      supported: false,
      reason: 'request-failed',
      message: upstream?.message ?? (error instanceof Error ? error.message : '请求失败'),
    };
  }

  const amount = resolveExpression(payload, row.balanceAmountPath);
  if (amount == null) {
    return { supported: false, reason: 'parse-failed', message: `无法按路径解析余额：${row.balanceAmountPath}` };
  }

  const currencyRaw = row.balanceCurrencyPath ? resolvePath(payload, row.balanceCurrencyPath) : undefined;
  const currency = typeof currencyRaw === 'string' && currencyRaw.trim() ? currencyRaw.trim() : 'USD';
  const isAvailableRaw = pickFirst(payload, [
    'is_active',
    'is_available',
    'data.is_active',
    'data.is_available',
    'isAvailable',
    'data.isAvailable',
  ]);
  const usedRaw = pickFirst(payload, [
    'used',
    'used_quota',
    'data.used',
    'data.used_quota',
    'data.total_usage',
    'total_usage',
  ]);

  return {
    supported: true,
    balance: amount,
    currency,
    used: asFiniteNumber(usedRaw),
    isAvailable: typeof isAvailableRaw === 'boolean' ? isAvailableRaw : null,
  };
}
