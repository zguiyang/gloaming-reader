'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';

import { authSocialButtonClassName } from '@/features/auth/auth-field';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';

type SocialProvider = 'github';

const SOCIAL_PROVIDER_KEY = 'auth.social.github' as const;

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  );
}

function AuthSocialDivider() {
  const { locale } = useLocale();

  return (
    <div className="flex items-center gap-3" role="separator" aria-label={t(locale, 'auth.social.dividerAria')}>
      <div className="h-px flex-1 bg-border/60" />
      <span className="text-xs text-muted-foreground">{t(locale, 'auth.social.or')}</span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

type AuthSocialButtonProps = {
  provider: SocialProvider;
};

function AuthSocialButton({ provider }: AuthSocialButtonProps) {
  const { locale } = useLocale();
  const [isSigningIn, setIsSigningIn] = useState(false);

  async function handleSignIn() {
    if (isSigningIn) {
      return;
    }

    setIsSigningIn(true);
    const { error } = await authClient.loginWithSocial(provider);
    if (error) {
      setIsSigningIn(false);
      const message = error.message || t(locale, 'auth.errors.signInFailed');
      toast.error(message);
    }
  }

  return (
    <button
      type="button"
      className={authSocialButtonClassName}
      disabled={isSigningIn}
      aria-busy={isSigningIn}
      onClick={() => {
        void handleSignIn();
      }}
    >
      <GitHubIcon className="absolute left-3.5 size-[1.125rem] text-foreground" />
      <span className="w-full text-center">
        {isSigningIn ? t(locale, 'auth.signIn.submitting') : t(locale, SOCIAL_PROVIDER_KEY)}
      </span>
    </button>
  );
}

export function AuthSocialLoginSection() {
  return (
    <div className="flex flex-col gap-3">
      <AuthSocialDivider />
      <AuthSocialButton provider="github" />
    </div>
  );
}
