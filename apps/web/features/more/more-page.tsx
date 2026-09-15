'use client';

import { UserCircleIcon } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { AUTH_ROUTES } from '@/constants';
import { useAuthDialog } from '@/features/auth';
import { MoreMenuRow } from '@/features/more/more-menu-row';
import { MoreUserHeader } from '@/features/more/more-user-header';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

export function MorePage() {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const session = authClient.useSession();

  useEffect(() => {
    if (!session.isPending && session.error?.status === 401) {
      openLogin();
    }
  }, [openLogin, session.error?.status, session.isPending]);

  const user = session.data?.user ?? null;
  const username = user?.username?.trim() || user?.name?.trim() || t(locale, 'nav.defaultReaderName');
  const email = user?.email?.trim() || '';
  const initial = username.slice(0, 1).toUpperCase();
  const image = user?.image?.trim() || null;

  async function signOut() {
    const { error } = await authClient.signOut();
    if (error) {
      toast.error(error.message || t(locale, 'auth.signOutFailed'));
      return;
    }
    toast.success(t(locale, 'auth.signOutSuccess'));
    window.location.assign('/');
  }

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-lg flex-col gap-6',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500',
      )}
    >
      <MoreUserHeader
        username={username}
        email={email}
        initial={initial}
        image={image}
        isSignedIn={Boolean(user)}
        onSignOut={() => void signOut()}
        onSignIn={() => openLogin()}
      />

      <nav aria-label={t(locale, 'more.menuAria')}>
        <ul>
          <MoreMenuRow
            href={AUTH_ROUTES.account}
            icon={<UserCircleIcon className="size-5" strokeWidth={1.5} aria-hidden />}
            label={t(locale, 'more.accountSettings')}
          />
        </ul>
      </nav>
    </div>
  );
}
