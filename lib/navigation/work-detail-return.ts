import { AUTH_ROUTES } from '@/constants';

const APP_ORIGIN = 'https://gloaming.invalid';

/** Resolve only known in-app destinations for returning from a Work detail page. */
export function resolveWorkDetailReturnTo(value: string | string[] | undefined, workId: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return AUTH_ROUTES.library;
  }
  if (/[\\\u0000-\u001f\u007f#]/.test(value)) {
    return AUTH_ROUTES.library;
  }

  let target: URL;
  try {
    target = new URL(value, APP_ORIGIN);
    decodeURIComponent(value);
  } catch {
    return AUTH_ROUTES.library;
  }

  if (target.origin !== APP_ORIGIN || target.username || target.password) {
    return AUTH_ROUTES.library;
  }

  const rawPath = value.split(/[?#]/, 1)[0];
  if (target.pathname !== rawPath) {
    return AUTH_ROUTES.library;
  }

  const isAllowedPath =
    target.pathname === AUTH_ROUTES.library ||
    target.pathname === AUTH_ROUTES.discover ||
    target.pathname === AUTH_ROUTES.history ||
    target.pathname === `/read/${encodeURIComponent(workId)}`;
  if (!isAllowedPath) {
    return AUTH_ROUTES.library;
  }

  const query = target.searchParams.toString();
  return query ? `${target.pathname}?${query}` : target.pathname;
}

export function workDetailHref(workId: string, returnTo: string): string {
  const query = new URLSearchParams({ returnTo });
  return `${AUTH_ROUTES.workDetail(workId)}?${query.toString()}`;
}

export function legacyWorkDetailRedirect(workId: string, returnTo: string | string[] | undefined): string {
  return workDetailHref(workId, resolveWorkDetailReturnTo(returnTo, workId));
}

export function workDetailReturnLabelKey(
  returnTo: string,
):
  | 'content.common.backToLibrary'
  | 'content.common.backToDiscover'
  | 'content.common.backToHistory'
  | 'content.common.backToReader' {
  if (returnTo === AUTH_ROUTES.discover || returnTo.startsWith(`${AUTH_ROUTES.discover}?`)) {
    return 'content.common.backToDiscover';
  }
  if (returnTo === AUTH_ROUTES.history || returnTo.startsWith(`${AUTH_ROUTES.history}?`)) {
    return 'content.common.backToHistory';
  }
  if (returnTo.startsWith(`${AUTH_ROUTES.read}/`)) {
    return 'content.common.backToReader';
  }
  return 'content.common.backToLibrary';
}
