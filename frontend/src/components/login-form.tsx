'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest, setAccessToken } from '@/lib/api/client';

type LoginFormProps = {
  audience: 'staff' | 'student';
  tenantSlug?: string;
};

export default function LoginForm({ audience, tenantSlug: studentTenantSlug }: LoginFormProps) {
  const router = useRouter();
  const isStudent = audience === 'student';
  const [staffTenantSlug, setStaffTenantSlug] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const response = await apiRequest<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        tenantSlug: isStudent ? studentTenantSlug : staffTenantSlug.trim(),
        login: login.trim(),
        password,
      }),
    });
    setSubmitting(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }

    setAccessToken(response.data.accessToken);
    const profile = await apiRequest<{ roles: string[] }>('/auth/profile');
    if (!profile.ok) {
      const logout = await apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      setAccessToken(null);
      setError(logout.ok || logout.status === 401
        ? profile.message
        : `${profile.message} Sign out failed: ${logout.message}`);
      setSubmitting(false);
      return;
    }
    if (isStudent && !profile.data.roles.includes('Resident')) {
      const logout = await apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      setAccessToken(null);
      setError(logout.ok || logout.status === 401
        ? 'This account is not a student account. Please use staff sign in.'
        : `This account is not a student account. Please use staff sign in. Sign out failed: ${logout.message}`);
      setSubmitting(false);
      return;
    }
    router.replace(profile.data.roles.includes('Resident') ? '/resident' : '/reception');
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">{isStudent ? 'STUDENT PORTAL' : 'HOSTEL MANAGEMENT SYSTEM'}</span>
        <h1>{isStudent ? 'Student sign in' : 'Welcome back'}</h1>
        <p>{isStudent ? 'Sign in with the account provided by your hostel.' : 'Sign in to manage your hostel operations.'}</p>
        {!isStudent && (
          <label>
            Hostel ID
            <input required autoComplete="organization" value={staffTenantSlug} onChange={(event) => setStaffTenantSlug(event.target.value)} />
          </label>
        )}
        <label>
          {isStudent ? 'Student email or phone' : 'Email or phone'}
          <input required autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} />
        </label>
        <label>
          Password
          <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full-width" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {isStudent && <a className="quiet-link" href="/login">Staff sign in</a>}
        <a className="quiet-link" href="/">Return to public page</a>
        {!isStudent && <a className="quiet-link" href="/platform-admin/login">Platform administrator sign in</a>}
      </form>
    </main>
  );
}
