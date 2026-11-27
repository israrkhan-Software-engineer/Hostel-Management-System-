'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest, setAccessToken } from '@/lib/api/client';
import Icon from './ui/icon';

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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 7000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 9000);
    return () => clearTimeout(timer);
  }, [error]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (newPassword !== newPasswordConfirmation) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    const response = await apiRequest<void>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setBusy(false);
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
    setBusy(true);
    const response = await apiRequest<{ authenticatorUri: string }>('/auth/mfa/enroll', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setAuthenticatorUri(response.data.authenticatorUri);
    setPassword('');
    setMessage('Add the authenticator URI to your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit verification code below.');
  }

  async function completeEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const response = await apiRequest<{ recoveryCodes: string[] }>('/auth/mfa/enroll/complete', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    onMfaEnabled();
    setAuthenticatorUri('');
    setCode('');
    setRecoveryCodes(response.data.recoveryCodes);
    setMessage('MFA successfully enabled! Save these recovery codes in a secure location; they will not be shown again.');
  }

  return (
    <div className="security-settings-container">
      {message && (
        <div className="notice success" role="status">
          <Icon name="checkCircle" size={18} />
          <span style={{ flex: 1 }}>{message}</span>
          <button type="button" className="notice-close" onClick={() => setMessage('')} aria-label="Dismiss message">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          <Icon name="alert" size={18} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="notice-close" onClick={() => setError('')} aria-label="Dismiss error">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div className="security-cards-grid">
        {/* CARD 1: TWO-FACTOR AUTHENTICATION (MFA) */}
        <section className="panel security-card">
          <div className="panel-heading">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="shield" size={18} />
                <h2>Two-Factor Authentication (MFA)</h2>
              </div>
              <p>Add a time-based one-time password (TOTP) step to protect your account.</p>
            </div>
            <span className={`status ${mfaEnabled ? 'active' : 'neutral'}`}>
              {mfaEnabled ? 'MFA ACTIVE' : 'NOT ENABLED'}
            </span>
          </div>

          {mfaEnabled ? (
            <div className="security-status-active">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--color-success)', fontWeight: 600 }}>
                <Icon name="check" size={20} />
                <span>Authenticator MFA is enabled and active for your account.</span>
              </div>
              <p className="muted" style={{ marginTop: '8px', fontSize: '13px' }}>
                Your account prompts for a 6-digit authenticator code on each new sign-in session.
              </p>
            </div>
          ) : !authenticatorUri ? (
            <form className="stack-form" onSubmit={(event) => void beginEnrollment(event)}>
              <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
                Protect your account against unauthorized access with Google Authenticator or Microsoft Authenticator.
              </p>
              <label>
                Confirm current password to begin setup
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="Enter current password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <div>
                <button className="button primary" type="submit" disabled={busy}>
                  <Icon name="shield" size={15} />
                  {busy ? 'Initiating…' : 'Begin Authenticator Setup'}
                </button>
              </div>
            </form>
          ) : (
            <form className="stack-form" onSubmit={(event) => void completeEnrollment(event)}>
              <div className="mfa-setup-instructions" style={{ padding: '14px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <strong>Step 2 of 2: Connect Authenticator</strong>
                <p style={{ margin: '6px 0 10px', fontSize: '13px' }}>
                  Copy this URI or tap the link on mobile to add it to your authenticator app:
                </p>
                <div style={{ marginBottom: '10px' }}>
                  <a href={authenticatorUri} className="button secondary small" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Icon name="arrowRight" size={14} /> Open in authenticator app
                  </a>
                </div>
                <label>
                  Setup Key / URI
                  <input
                    readOnly
                    value={authenticatorUri}
                    style={{ fontSize: '12px', fontFamily: 'monospace' }}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
              </div>

              <label>
                Enter 6-digit verification code from your app
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  placeholder="123456"
                  style={{ fontSize: '20px', letterSpacing: '4px', textAlign: 'center', maxWidth: '240px' }}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>

              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy || code.length !== 6}>
                  <Icon name="check" size={16} />
                  {busy ? 'Verifying…' : 'Verify & Enable MFA'}
                </button>
                <button className="button secondary" type="button" onClick={() => setAuthenticatorUri('')}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {recoveryCodes.length > 0 && (
            <div className="recovery-codes-box" style={{ marginTop: '20px', padding: '16px', background: 'var(--color-bg-subtle)', border: '1px solid var(--color-warning-border, var(--color-border))', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-warning-text)' }}>
                <Icon name="alert" size={16} />
                <strong>Save Your Recovery Codes</strong>
              </div>
              <p style={{ margin: '6px 0 12px', fontSize: '13px' }}>
                Store these recovery codes securely. Each code can be used once if you ever lose your authenticator device.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                {recoveryCodes.map((recoveryCode) => (
                  <code key={recoveryCode} style={{ padding: '6px 10px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontWeight: 'bold' }}>
                    {recoveryCode}
                  </code>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* CARD 2: PASSWORD CHANGE */}
        <section className="panel security-card">
          <div className="panel-heading">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="refresh" size={18} />
                <h2>Change Password</h2>
              </div>
              <p>Keep your account secure with regular password updates.</p>
            </div>
          </div>

          <form className="stack-form" onSubmit={(event) => void changePassword(event)}>
            <label>
              Current password
              <input
                required
                type="password"
                autoComplete="current-password"
                placeholder="Enter current password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>

            <div className="form-row">
              <label>
                New password
                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={128}
                  pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\s]).{12,128}"
                  autoComplete="new-password"
                  placeholder="Min 12 characters"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm new password
                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="Re-enter new password"
                  value={newPasswordConfirmation}
                  onChange={(event) => setNewPasswordConfirmation(event.target.value)}
                />
              </label>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '12px' }}>
              Password must be at least 12 characters and contain uppercase, lowercase, number, and special character.
            </p>

            <div>
              <button className="button primary" type="submit" disabled={busy}>
                Update Password & Sign Out
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
