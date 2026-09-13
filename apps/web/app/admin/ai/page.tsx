import { redirect } from 'next/navigation';

import { ADMIN_ROUTES } from '@/constants';

export default function AdminAiPage() {
  redirect(ADMIN_ROUTES.configTab('ai'));
}
