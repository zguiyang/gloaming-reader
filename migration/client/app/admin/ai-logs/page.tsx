import { redirect } from 'next/navigation';

import { ADMIN_ROUTES } from '@/constants';

export default function AdminAiLogsPage() {
  redirect(ADMIN_ROUTES.logsTab('ai'));
}
