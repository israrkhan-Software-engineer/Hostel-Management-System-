'use client';

import { Suspense } from 'react';
import { PasswordResetCompletionForm } from '@/components/password-reset-forms';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="workspace-loading">Loading password reset…</main>}>
      <PasswordResetCompletionForm />
    </Suspense>
  );
}
