import { redirect } from 'next/navigation';

import { ADMIN_ROUTES } from '@/constants';

export default function AdminTtsLogsPage() {
  redirect(ADMIN_ROUTES.logsTab('tts'));
}
