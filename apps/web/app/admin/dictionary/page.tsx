import { redirect } from 'next/navigation';

import { ADMIN_ROUTES } from '@/constants';

export default function AdminDictionaryPage() {
  redirect(ADMIN_ROUTES.configTab('dictionary'));
}
