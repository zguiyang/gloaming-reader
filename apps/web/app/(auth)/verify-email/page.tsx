import { Suspense } from 'react';

import { VerifyEmailForm } from '@/features/auth/verify-email-form';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
