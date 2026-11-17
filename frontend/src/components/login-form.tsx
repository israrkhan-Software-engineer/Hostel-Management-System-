'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest, setAccessToken } from '@/lib/api/client';

type LoginFormProps = {
  audience: 'staff' | 'student';
  tenantSlug?: string;
};

export default function LoginForm({ audience, tenantSlug: studentTenantSlug }: LoginFormProps) {
  const router = useRouter();
  const isStudent = audience === 'student';
  const [studentSlug, setStudentSlug] = useState(studentTenantSlug ?? '');
  const [staffTenantSlug, setStaffTenantSlug] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (isStudent && !studentSlug.trim()) {
      setError('Enter your hostel ID to continue.');
      return;
    }
    setSubmitting(true);
    const response = await apiRequest<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        tenantSlug: isStudent ? studentSlug.trim() : staffTenantSlug.trim(),
        login: login.trim(),
        password,
        ...(mfaCode.trim() ? { mfaCode: mfaCode.trim() } : {}),
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
    const tenantSlug = isStudent ? studentSlug.trim() : staffTenantSlug.trim();
    router.replace(profile.data.roles.includes('Resident')
      ? `/resident?hostel=${encodeURIComponent(tenantSlug)}`
      : '/reception');
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">{isStudent ? 'STUDENT PORTAL' : 'HOSTEL MANAGEMENT SYSTEM'}</span>
        <h1>{isStudent ? 'Student sign in' : 'Welcome back'}</h1>
        <p>{isStudent ? 'Sign in with the account provided by your hostel.' : 'Sign in to manage your hostel operations.'}</p>
        {(!isStudent || !studentTenantSlug) && (
          <label>
            Hostel ID
            <input
              required
              autoComplete="organization"
              value={isStudent ? studentSlug : staffTenantSlug}
              onChange={(event) => isStudent
                ? setStudentSlug(event.target.value)
                : setStaffTenantSlug(event.target.value)}
            />
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
        <label>
          Authenticator or recovery code (if enabled)
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={mfaCode}
            onChange={(event) => setMfaCode(event.target.value)}
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full-width" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <Link className="quiet-link" href="/forgot-password">Forgot your password?</Link>
        {isStudent && <Link className="quiet-link" href="/login">Staff sign in</Link>}
        <Link className="quiet-link" href="/">Return to public page</Link>
        {!isStudent && <Link className="quiet-link" href="/platform-admin/login">Platform administrator sign in</Link>}
      </form>
    </main>
  );
}
