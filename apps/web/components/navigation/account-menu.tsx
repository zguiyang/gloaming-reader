'use client';

import { Menu } from '@base-ui/react/menu';
import { CheckIcon, LogOutIcon, Settings2, UserCircleIcon } from 'lucide-react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { getNavCopy } from '@/components/navigation/nav-config';
import { UserAvatar } from '@/components/user-avatar';
import { ADMIN_ROUTES, AUTH_ADMIN_ROLE, AUTH_ROUTES } from '@/constants';
import { authClient, resolveAuthErrorMessage } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

export function useNavAccount() {
  const { locale } = useLocale();
  const navCopy = getNavCopy(locale);
  const { data, isPending } = authClient.useSession();
  const user = data?.user ?? null;
  const username = user?.username?.trim() || user?.name?.trim() || navCopy.defaultReaderName;
  const email = user?.email?.trim() || '';
  const initial = username.slice(0, 1).toUpperCase();
  const image = user?.image?.trim() || null;
  const isAdmin = user?.role === AUTH_ADMIN_ROLE;

  async function signOut() {
    const { error } = await authClient.signOut();
    if (error) {
      toast.error(resolveAuthErrorMessage(error, locale, 'auth.signOutFailed'));
      return;
    }
    toast.success(t(locale, 'auth.signOutSuccess'));
    window.location.assign('/');
  }

  return {
    user,
    isPending,
    username,
    email,
    initial,
    image,
    isAdmin,
    signOut: () => void signOut(),
  };
}

type AccountMenuProps = {
  username: string;
  email: string;
  initial: string;
  image: string | null;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => void;
  triggerClassName?: string;
};

const menuItemClass = cn(
  'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm',
  'text-foreground outline-none select-none',
  'data-highlighted:bg-muted',
);

export function AccountMenu({
  username,
  email,
  initial,
  image,
  isAdmin,
  open,
  onOpenChange,
  onSignOut,
  triggerClassName,
}: AccountMenuProps) {
  const { locale, setLocale, localeOptions } = useLocale();
  const navCopy = getNavCopy(locale);
  const accountAriaLabel = t(locale, 'nav.accountMenuAria', {
    username,
    email,
    account: navCopy.account,
  });

  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Menu.Trigger
        className={cn(
          'flex size-9 items-center justify-center overflow-hidden rounded-full',
          'outline-none transition-opacity duration-300 ease-out-soft hover:opacity-90',
          'focus-visible:ring-3 focus-visible:ring-ring/50',
          triggerClassName,
        )}
        aria-label={accountAriaLabel}
      >
        <UserAvatar image={image} initial={initial} sizeClass="size-9 text-sm" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50 outline-none" sideOffset={8} align="end">
          <Menu.Popup
            className={cn(
              'min-w-56 rounded-xl bg-card p-1 shadow-card ring-1 ring-foreground/5 outline-none',
              'transition-opacity duration-200 ease-out-soft',
              'data-starting-style:opacity-0 data-ending-style:opacity-0',
            )}
          >
            <div className="flex items-center gap-3 px-2.5 py-2.5">
              <UserAvatar image={image} initial={initial} sizeClass="size-10 text-sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{username}</div>
                <div className="truncate text-xs text-muted-foreground">{email}</div>
              </div>
            </div>
            <div className="mx-1 my-1 h-px bg-border" role="separator" />
            <Menu.Group>
              <Menu.GroupLabel className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                {navCopy.interfaceLanguage}
              </Menu.GroupLabel>
              <Menu.RadioGroup
                value={locale}
                onValueChange={(value) => {
                  if (value === 'zh-CN' || value === 'en-US') {
                    setLocale(value);
                  }
                }}
              >
                {localeOptions.map((option) => (
                  <Menu.RadioItem
                    key={option.value}
                    value={option.value}
                    label={option.label}
                    aria-label={option.label}
                    className={menuItemClass}
                  >
                    {option.label}
                    <Menu.RadioItemIndicator className="flex size-4 items-center justify-center text-primary">
                      <CheckIcon className="size-4" strokeWidth={2} aria-hidden />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <div className="mx-1 my-1 h-px bg-border" role="separator" />
            <Menu.Item
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
                'text-foreground outline-none select-none',
                'data-highlighted:bg-muted',
              )}
              onClick={() => {
                onOpenChange(false);
                window.location.assign(AUTH_ROUTES.account);
              }}
            >
              <UserCircleIcon className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              {t(locale, 'nav.accountCenter')}
            </Menu.Item>
            {isAdmin ? (
              <Menu.Item
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
                  'text-foreground outline-none select-none',
                  'data-highlighted:bg-muted',
                )}
                onClick={() => {
                  window.location.assign(ADMIN_ROUTES.works);
                }}
              >
                <Settings2 className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                {navCopy.admin}
              </Menu.Item>
            ) : null}
            <Menu.Item
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
                'text-foreground outline-none select-none',
                'data-highlighted:bg-muted',
              )}
              onClick={onSignOut}
            >
              <LogOutIcon className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              {navCopy.signOut}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
