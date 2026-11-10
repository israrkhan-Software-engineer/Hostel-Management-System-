'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest, setAccessToken } from '@/lib/api/client';

type AccountSecurityPanelProps = {
  mfaEnabled: boolean;
  onMfaEnabled: () => void;
};

export default function AccountSecurityPanel({
  mfaEnabled,
  onMfaEnabled,
}: AccountSecurityPanelProps) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [authenticatorUri, setAuthenticatorUri] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (newPassword !== newPasswordConfirmation) {
      setError('New password and confirmation do not match.');
      return;
    }
    const response = await apiRequest<void>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setNewPasswordConfirmation('');
    setAccessToken(null);
    router.replace('/login?passwordChanged=1');
  }

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const response = await apiRequest<{ authenticatorUri: string }>('/auth/mfa/enroll', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setAuthenticatorUri(response.data.authenticatorUri);
    setPassword('');
    setMessage('Add this authenticator URI to your authenticator app, then enter its six-digit code below.');
  }

  async function completeEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const response = await apiRequest<{ recoveryCodes: string[] }>('/auth/mfa/enroll/complete', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      setError(response.message);
      return;
    }
    onMfaEnabled();
    setAuthenticatorUri('');
    setCode('');
    setRecoveryCodes(response.data.recoveryCodes);
    setMessage('MFA is enabled. Save these recovery codes somewhere safe; they are shown only once.');
  }

  return (
    <details className="panel">
      <summary>Account security</summary>
      {mfaEnabled ? (
        <p>Authenticator MFA is enabled for your account.</p>
      ) : !authenticatorUri ? (
        <form className="stack-form" onSubmit={(event) => void beginEnrollment(event)}>
          <p>Enable optional authenticator MFA for an additional sign-in check.</p>
          <label>Confirm your password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="button secondary" type="submit">Set up authenticator MFA</button>
        </form>
      ) : (
        <form className="stack-form" onSubmit={(event) => void completeEnrollment(event)}>
          <p>Open this setup link with your authenticator, then enter the current six-digit code.</p>
          <a href={authenticatorUri}>Open in authenticator app</a>
          <label>Authenticator setup URI
            <input
              readOnly
              value={authenticatorUri}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <label>Six-digit code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button className="button primary" type="submit">Verify and enable MFA</button>
        </form>
      )}
      <form className="stack-form" onSubmit={(event) => void changePassword(event)}>
        <h3>Change password</h3>
        <label>Current password
          <input required type="password" autoComplete="current-password" value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label>New password
          <input required type="password" minLength={12} maxLength={128}
            pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\\s]).{12,128}"
            autoComplete="new-password" value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label>Confirm new password
          <input required type="password" minLength={12} maxLength={128} autoComplete="new-password"
            value={newPasswordConfirmation} onChange={(event) => setNewPasswordConfirmation(event.target.value)} />
        </label>
        <button className="button secondary" type="submit">Change password and sign out</button>
      </form>
      {message && <p className="notice success" role="status">{message}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {recoveryCodes.length > 0 && (
        <ul aria-label="MFA recovery codes">
          {recoveryCodes.map((recoveryCode) => (
            <li key={recoveryCode}><code>{recoveryCode}</code></li>
          ))}
        </ul>
      )}
    </details>
  );
}
