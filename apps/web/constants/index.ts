export { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
export const APP_NAME = '书灯阅读' as const;

export const AUTH_ROUTES = {
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  shelf: '/my-shelf',
  /** Discover catalog. */
  discover: '/discover',
  /** Discover book detail (catalog + shelf hybrid). */
  bookDetail: (id: string) => `/discover/${id}` as const,
  history: '/reading-history',
  /** Immersive reader. */
  read: '/read',
  readBook: (id: string, partId?: string) =>
    partId ? (`/read/${id}?part=${encodeURIComponent(partId)}` as const) : (`/read/${id}` as const),
} as const;

export const ADMIN_ROUTES = {
  root: '/admin',
  works: '/admin/works',
  workNew: '/admin/works/new',
  workDetail: (id: string) => `/admin/works/${id}` as const,
  workPreview: (id: string) => `/admin/works/${id}/preview` as const,
  workPreviewPart: (id: string, partId: string) => `/admin/works/${id}/preview/part/${partId}` as const,
  assets: '/admin/assets',
  ai: '/admin/ai',
  aiLogs: '/admin/ai-logs',
  tts: '/admin/tts',
  ttsLogs: '/admin/tts-logs',
  dictionary: '/admin/dictionary',
  taxonomy: '/admin/taxonomy',
} as const;
