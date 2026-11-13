'use client';

import { useSyncExternalStore } from 'react';

export const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

/**
 * Whether the viewport matches the desktop breakpoint.
 *
 * The server snapshot is `true`, matching the three call sites this replaced, so
 * the SSR markup and the hydration pass agree; it settles after mount.
 *
 * `features/landing/landing-motion.tsx` deliberately keeps its own copy: it
 * starts at `false` so motion is never triggered on the first paint, which is a
 * different contract rather than a duplicate.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
    () => true,
  );
}
