'use client';

import { LogOutIcon } from 'lucide-react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/user-avatar';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type MoreUserHeaderProps = {
  username: string;
  email: string;
  initial: string;
  image: string | null;
  isSignedIn: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
};

export function MoreUserHeader({
  username,
  email,
  initial,
  image,
  isSignedIn,
  onSignOut,
  onSignIn,
}: MoreUserHeaderProps) {
  const { locale } = useLocale();

  return (
    <header
      className={cn('flex items-center gap-3 border-b border-border/60 pb-5', 'md:max-w-lg md:mx-auto md:w-full')}
    >
      <UserAvatar image={image} initial={initial} sizeClass="size-12 text-base" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-foreground">{username}</p>
        <p className="truncate text-sm text-muted-foreground">{email || '\u00a0'}</p>
      </div>
      {isSignedIn ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 shrink-0 px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={onSignOut}
        >
          <LogOutIcon className="size-4" strokeWidth={1.5} aria-hidden />
          {t(locale, 'nav.signOut')}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 shrink-0 px-3 text-sm font-medium text-primary"
          onClick={onSignIn}
        >
          {t(locale, 'nav.signIn')}
        </Button>
      )}
    </header>
  );
}
