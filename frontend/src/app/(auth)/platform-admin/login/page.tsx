'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import QRCode from 'qrcode';
import { apiRequest, setAccessToken } from '@/lib/api/client';

type PlatformLoginResponse =
  | { accessToken: string; expiresIn: number }
  | { mfaEnrollmentRequired: true; enrollmentToken: string; authenticatorUri: string };

export default function PlatformAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaEnrollment, setMfaEnrollment] = useState<{
    enrollmentToken: string;
    authenticatorUri: string;
    qrCodeDataUrl: string;
  } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [enrollmentAccessToken, setEnrollmentAccessToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function renderEnrollmentQr(enrollmentToken: string, uri: string) {
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(uri, { width: 240, margin: 2 });
      setMfaEnrollment({ enrollmentToken, authenticatorUri: uri, qrCodeDataUrl });
    } catch {
      setError('Could not generate the authenticator QR code. Please try signing in again.');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    setAccessToken(null);
    const response = mfaEnrollment
      ? await apiRequest<{ recoveryCodes: string[]; accessToken: string }>(
          '/platform/admin/auth/enroll-mfa',
          {
            method: 'POST',
            body: JSON.stringify({
              enrollmentToken: mfaEnrollment.enrollmentToken,
              code: mfaCode.trim(),
            }),
          },
        )
      : await apiRequest<PlatformLoginResponse>('/platform/admin/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            password,
            ...(mfaCode.trim() ? { mfaCode: mfaCode.trim() } : {}),
          }),
        });
    setSubmitting(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    if ('recoveryCodes' in response.data) {
      setRecoveryCodes(response.data.recoveryCodes);
      setEnrollmentAccessToken(response.data.accessToken);
      return;
    }
    if ('mfaEnrollmentRequired' in response.data) {
      setMfaCode('');
      await renderEnrollmentQr(response.data.enrollmentToken, response.data.authenticatorUri);
      return;
    }
    setAccessToken(response.data.accessToken);
    router.replace('/system-admin');
  }

  function continueToDashboard() {
    setAccessToken(enrollmentAccessToken);
    router.replace('/system-admin');
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">HOSTEL MANAGEMENT SYSTEM</span>
        <h1>Platform administrator</h1>
        <p>
          {recoveryCodes
            ? 'Save your one-time recovery codes securely before continuing.'
            : mfaEnrollment
              ? 'Scan this QR code with your authenticator app, then enter its current 6-digit code.'
              : 'Sign in with your platform administrator email and password.'}
        </p>
        {recoveryCodes ? (
          <>
            <ul aria-label="One-time recovery codes">
              {recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}
            </ul>
            <small className="muted">
              These codes are shown once. Store them securely; each code can be used only once.
            </small>
            <button className="button primary full-width" type="button" onClick={continueToDashboard}>
              I saved the codes — continue
            </button>
          </>
        ) : (
          <>
            {mfaEnrollment && (
              <>
                <Image
                  src={mfaEnrollment.qrCodeDataUrl}
                  alt="Authenticator setup QR code"
                  width={240}
                  height={240}
                  unoptimized
                />
                <small className="muted">If you cannot scan the QR code, enter this setup key manually:</small>
                <code className="muted" style={{ overflowWrap: 'anywhere' }}>
                  {new URL(mfaEnrollment.authenticatorUri).searchParams.get('secret')}
                </code>
              </>
            )}
            {!mfaEnrollment && (
              <>
                <label>
                  Administrator email
                  <input
                    required
                    type="email"
                    autoComplete="username"
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    required
                    type="password"
                    autoComplete="current-password"
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              </>
            )}
            <label>
              {mfaEnrollment
                ? 'Authenticator code'
                : 'Authenticator or recovery code (leave blank for first-time setup)'}
              <input
                required={Boolean(mfaEnrollment)}
                inputMode="text"
                autoComplete="one-time-code"
                minLength={mfaEnrollment ? 6 : undefined}
                maxLength={mfaEnrollment ? 6 : 16}
                pattern={mfaEnrollment ? '\\d{6}' : '(?:[0-9]{6}|[A-Fa-f0-9]{16})'}
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
              />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button primary full-width" type="submit" disabled={submitting}>
              {submitting
                ? mfaEnrollment ? 'Enabling authenticator…' : 'Signing in…'
                : mfaEnrollment ? 'Enable authenticator' : 'Sign in'}
            </button>
          </>
        )}
        <a className="quiet-link" href="/">Return to public page</a>
      </form>
    </main>
  );
}
