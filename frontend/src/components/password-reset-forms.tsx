'use client';

import { FormEvent, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiRequest } from '../lib/api/client';

export function PasswordResetRequestForm() {
  const [tenantSlug, setTenantSlug] = useState('');
  const [login, setLogin] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await apiRequest<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ tenantSlug: tenantSlug.trim(), login: login.trim() }),
    });
    setBusy(false);
    if (!result.ok) setError(result.message);
    else setMessage(result.data.message);
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">ACCOUNT RECOVERY</span>
        <h1>Reset your password</h1>
        <p>Enter your hostel ID and account email or phone. If the account exists, we will email a secure reset link.</p>
        <label>Hostel ID<input required value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)} autoComplete="organization" /></label>
        <label>Email or phone<input required value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="notice success" role="status">{message}</p>}
        <button className="button primary full-width" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        <a className="quiet-link" href="/login">Return to sign in</a>
      </form>
    </main>
  );
}

export function PasswordResetCompletionForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await apiRequest<void>('/auth/reset-password/complete', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
    setBusy(false);
    if (!result.ok) setError(result.message);
    else setMessage('Your password has been updated. You can now sign in.');
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">ACCOUNT RECOVERY</span>
        <h1>Choose a new password</h1>
        <label>New password<input required minLength={8} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        {!token && <p className="form-error" role="alert">This reset link is missing its token. Request another link.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="notice success" role="status">{message}</p>}
        {!message && <button className="button primary full-width" type="submit" disabled={busy || !token}>{busy ? 'Updating…' : 'Update password'}</button>}
        <a className="quiet-link" href="/login">Return to sign in</a>
      </form>
    </main>
  );
}
