import { redirect } from 'next/navigation';

import { ADMIN_ROUTES } from '@/constants';

export default function AdminTtsPage() {
  redirect(ADMIN_ROUTES.configTab('tts'));
}
