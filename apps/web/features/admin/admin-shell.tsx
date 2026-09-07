'use client';

import { ArrowLeft, AudioLines, BookA, FileText, Menu, ScrollText, Sparkles, Tags, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';

import { isAdminRole } from '@gloaming/shared/auth';

import { BrandMark } from '@/components/brand-mark';
import { GlobalLoading } from '@/components/global-loading';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ADMIN_ROUTES, AUTH_ROUTES } from '@/constants';
import { useAuthDialog } from '@/features/auth';
import { authClient } from '@/lib/auth';
import { cn } from '@/lib/utils';

type AdminShellProps = {
  children: ReactNode;
};

type AdminNavItem = {
  href: string;
  label: string;
  icon: typeof FileText;
  isActive: boolean;
};

function adminNavItems(pathname: string): AdminNavItem[] {
  return [
    {
      href: ADMIN_ROUTES.works,
      label: '作品',
      icon: FileText,
      isActive: pathname.startsWith(ADMIN_ROUTES.works),
    },
    {
      href: ADMIN_ROUTES.ai,
      label: 'AI 配置',
      icon: Sparkles,
      isActive: pathname === ADMIN_ROUTES.ai || pathname.startsWith(`${ADMIN_ROUTES.ai}/`),
    },
    {
      href: ADMIN_ROUTES.taxonomy,
      label: '维度管理',
      icon: Tags,
      isActive: pathname === ADMIN_ROUTES.taxonomy || pathname.startsWith(`${ADMIN_ROUTES.taxonomy}/`),
    },
    {
      href: ADMIN_ROUTES.aiLogs,
      label: 'AI 日志',
      icon: ScrollText,
      isActive: pathname === ADMIN_ROUTES.aiLogs || pathname.startsWith(`${ADMIN_ROUTES.aiLogs}/`),
    },
    {
      href: ADMIN_ROUTES.tts,
      label: '语音配置',
      icon: Volume2,
      isActive: pathname === ADMIN_ROUTES.tts || pathname.startsWith(`${ADMIN_ROUTES.tts}/`),
    },
    {
      href: ADMIN_ROUTES.dictionary,
      label: '词典配置',
      icon: BookA,
      isActive: pathname === ADMIN_ROUTES.dictionary || pathname.startsWith(`${ADMIN_ROUTES.dictionary}/`),
    },
    {
      href: ADMIN_ROUTES.ttsLogs,
      label: '音频日志',
      icon: AudioLines,
      isActive: pathname === ADMIN_ROUTES.ttsLogs || pathname.startsWith(`${ADMIN_ROUTES.ttsLogs}/`),
    },
  ];
}

function AdminNavButton({ item, onNavigate }: { item: AdminNavItem; onNavigate?: () => void }) {
  return (
    <Button
      variant="ghost"
      nativeButton={false}
      className={cn(
        'h-auto justify-start gap-3 rounded-xl px-4 py-3 text-base font-normal transition-colors duration-300 ease-out-soft',
        item.isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-surface-container-high hover:text-foreground',
      )}
      render={
        <Link href={item.href} onClick={onNavigate}>
          <item.icon data-icon="inline-start" />
          {item.label}
        </Link>
      }
    />
  );
}

export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();
  const { data, isPending } = authClient.useSession();
  const { openLogin } = useAuthDialog();
  const user = data?.user ?? null;
  const [isNavOpen, setIsNavOpen] = useState(false);

  if (isPending) {
    return <GlobalLoading />;
  }

  if (!user) {
    return (
      <div className="flex h-dvh flex-1 items-center justify-center px-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">请先登录后再进入管理后台。</p>
          <Button type="button" className="mt-5 rounded-full px-6" onClick={() => openLogin()}>
            登录
          </Button>
        </div>
      </div>
    );
  }

  if (!isAdminRole(user.role)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-6 py-10">
        <section className="w-full max-w-md rounded-2xl border border-border bg-card px-8 py-10 text-center">
          <div className="mb-8 flex justify-center">
            <BrandMark href={AUTH_ROUTES.shelf} subtitle="管理后台" />
          </div>
          <p className="mb-3 text-sm font-medium tracking-[0.16em] text-primary">无权限</p>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">无法进入管理后台</h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            当前账号没有管理员权限。管理后台只对内容维护人员开放，你仍然可以返回首页继续阅读。
          </p>
          <Button nativeButton={false} className="mt-8 rounded-xl px-5" render={<Link href={AUTH_ROUTES.shelf} />}>
            返回首页
          </Button>
        </section>
      </div>
    );
  }

  const navItems = adminNavItems(pathname);

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <header className="flex shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar px-5 py-4 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Sheet open={isNavOpen} onOpenChange={setIsNavOpen}>
            <SheetTrigger
              render={<Button variant="ghost" size="icon" className="shrink-0" aria-label="打开管理导航" />}
            >
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" className="w-80 bg-sidebar text-sidebar-foreground" showCloseButton={false}>
              <SheetHeader className="border-b border-sidebar-border">
                <SheetTitle className="sr-only">管理导航</SheetTitle>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col px-6 pt-6 pb-3">
                <BrandMark href={ADMIN_ROUTES.works} size="md" subtitle="内容管理" className="mb-10" />
                <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                  {navItems.map((item) => (
                    <AdminNavButton key={item.href} item={item} onNavigate={() => setIsNavOpen(false)} />
                  ))}
                </nav>
                <Button
                  variant="ghost"
                  nativeButton={false}
                  className="mt-4 h-auto justify-start gap-2 rounded-xl px-4 py-3 font-normal text-muted-foreground transition-colors duration-300 ease-out-soft hover:bg-surface-container-high hover:text-foreground"
                  render={
                    <Link href={AUTH_ROUTES.shelf} onClick={() => setIsNavOpen(false)}>
                      <ArrowLeft data-icon="inline-start" />
                      返回首页
                    </Link>
                  }
                >
                  返回首页
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          <BrandMark href={ADMIN_ROUTES.works} subtitle="内容管理" className="min-w-0" />
        </div>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="gap-1.5 text-muted-foreground transition-colors duration-300 ease-out-soft hover:text-foreground"
          render={<Link href={AUTH_ROUTES.shelf} />}
        >
          <ArrowLeft data-icon="inline-start" />
          首页
        </Button>
      </header>

      <aside className="hidden h-full w-72 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar px-7 pt-7 pb-3 md:flex">
        <div className="min-h-0 flex-1">
          <BrandMark href={ADMIN_ROUTES.works} size="md" subtitle="内容管理" className="mb-12" />

          <nav className="flex flex-col gap-2">
            {navItems.map((item) => (
              <AdminNavButton key={item.href} item={item} />
            ))}
          </nav>
        </div>

        <Button
          variant="ghost"
          nativeButton={false}
          className="mt-4 h-auto justify-start gap-2 rounded-xl px-4 py-3 font-normal text-muted-foreground transition-colors duration-300 ease-out-soft hover:bg-surface-container-high hover:text-foreground"
          render={<Link href={AUTH_ROUTES.shelf} />}
        >
          <ArrowLeft data-icon="inline-start" />
          返回首页
        </Button>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto p-6 md:p-12">{children}</main>
    </div>
  );
}
