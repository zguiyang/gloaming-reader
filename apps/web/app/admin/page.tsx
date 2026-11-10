import { redirect } from 'next/navigation';

import { ADMIN_ROUTES } from '@/constants';

export default function AdminIndexPage() {
  redirect(ADMIN_ROUTES.assets);
}
