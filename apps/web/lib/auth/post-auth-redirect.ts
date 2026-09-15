import { AUTH_ROUTES } from '@/constants';

const AUTH_RETURN_STORAGE_KEY = 'gloaming.auth.returnPath';

const AUTH_ROUTE_PREFIXES = ['/verify-email', '/reset-password', '/auth-error'] as const;

function isSafeReturnPath(pathname: string): boolean {
  if (!pathname.startsWith('/')) {
    return false;
  }
  if (pathname.startsWith('//')) {
    return false;
  }
  return !AUTH_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function readReturnPathFromSearchParams(searchParams: URLSearchParams): string | null {
  for (const key of ['returnTo', 'returnPath']) {
    const value = searchParams.get(key)?.trim();
    if (!value) {
      continue;
    }
    const pathname = value.split('?')[0] ?? value;
    if (isSafeReturnPath(pathname)) {
      return value;
    }
  }
  return null;
}

export function rememberAuthReturnPath(explicitPath?: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const fromUrl = readReturnPathFromSearchParams(new URLSearchParams(window.location.search));
    if (fromUrl) {
      sessionStorage.setItem(AUTH_RETURN_STORAGE_KEY, fromUrl);
      return;
    }

    const path = explicitPath ?? `${window.location.pathname}${window.location.search}`;
    const pathname = path.split('?')[0] ?? path;
    if (!isSafeReturnPath(pathname) || pathname === '/') {
      return;
    }

    sessionStorage.setItem(AUTH_RETURN_STORAGE_KEY, path);
  } catch {
    // sessionStorage may throw in private mode.
  }
}

export function peekAuthReturnPath(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = sessionStorage.getItem(AUTH_RETURN_STORAGE_KEY)?.trim();
    if (!stored) {
      return null;
    }
    const pathname = stored.split('?')[0] ?? stored;
    return isSafeReturnPath(pathname) ? stored : null;
  } catch {
    return null;
  }
}

export function clearAuthReturnPath(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    sessionStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function resolvePostAuthPath(searchParams?: URLSearchParams): string {
  const fromUrl = searchParams ? readReturnPathFromSearchParams(searchParams) : null;
  const fromStorage = peekAuthReturnPath();
  return fromUrl ?? fromStorage ?? AUTH_ROUTES.shelf;
}

export function resolveSocialAuthErrorPath(): string {
  const params = new URLSearchParams({ returnTo: resolvePostAuthPath() });
  return `${AUTH_ROUTES.socialAuthError}?${params.toString()}`;
}

export function consumePostAuthPath(searchParams?: URLSearchParams): string {
  const path = resolvePostAuthPath(searchParams);
  clearAuthReturnPath();
  return path;
}
