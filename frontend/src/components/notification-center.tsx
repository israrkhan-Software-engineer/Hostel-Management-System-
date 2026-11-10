'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api/client';

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  category: string;
  readAt: string | null;
  createdAt: string;
};

type Preference = {
  category: string;
  inApp: boolean;
  email: boolean;
  sms: boolean;
};

const preferenceCategories = ['admission', 'announcement', 'finance', 'gate_pass', 'leave', 'subscription'];

export default function NotificationCenter() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [notificationsResult, preferencesResult] = await Promise.all([
      apiRequest<NotificationItem[]>('/notifications'),
      apiRequest<Preference[]>('/notifications/preferences'),
    ]);
    if (!notificationsResult.ok) {
      setError(notificationsResult.message);
      return;
    }
    if (!preferencesResult.ok) {
      setError(preferencesResult.message);
      return;
    }
    setItems(notificationsResult.data);
    setPreferences(preferencesResult.data);
    setError('');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    setBusy(true);
    const result = await apiRequest<{ updated: number }>('/notifications/read-all', { method: 'POST' });
    if (!result.ok) setError(result.message);
    else await load();
    setBusy(false);
  }

  async function markRead(id: string) {
    setBusy(true);
    const result = await apiRequest<NotificationItem>(`/notifications/${id}/read`, { method: 'PATCH' });
    if (!result.ok) setError(result.message);
    else setItems((current) => current.map((item) => item.id === id ? result.data : item));
    setBusy(false);
  }

  async function updatePreference(category: string, field: 'inApp' | 'email' | 'sms', value: boolean) {
    const current = preferences.find((item) => item.category === category);
    const next = { inApp: current?.inApp ?? true, email: current?.email ?? true, sms: current?.sms ?? false, [field]: value };
    const result = await apiRequest<Preference>(`/notifications/preferences/${encodeURIComponent(category)}`, {
      method: 'PATCH',
      body: JSON.stringify(next),
    });
    if (!result.ok) setError(result.message);
    else setPreferences((existing) => [...existing.filter((item) => item.category !== category), result.data]);
  }

  const unreadCount = items.filter((item) => !item.readAt).length;

  return (
    <details className="notification-center">
      <summary aria-label={`${unreadCount} unread notifications`}>
        Notifications{unreadCount ? <span className="notification-count">{unreadCount}</span> : null}
      </summary>
      <section className="notification-panel" aria-label="Notifications and preferences">
        <div className="notification-panel-heading">
          <div><h2>Notifications</h2><p>{unreadCount} unread</p></div>
          <button className="button secondary small" type="button" disabled={busy || unreadCount === 0} onClick={() => void markAllRead()}>
            Mark all read
          </button>
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
        {!items.length ? <p className="empty-state">No notifications yet.</p> : (
          <ul className="notification-list">
            {items.map((item) => (
              <li key={item.id} className={item.readAt ? '' : 'unread'}>
                <div><strong>{item.title}</strong><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div>
                {!item.readAt && (
                  <button className="button secondary small" type="button" disabled={busy} onClick={() => void markRead(item.id)}>
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <details className="notification-preferences">
          <summary>Notification preferences</summary>
          <p>Unconfigured categories use in-app and email notifications by default; SMS is off.</p>
          {preferenceCategories.map((category) => {
            const preference = preferences.find((item) => item.category === category)
              ?? { category, inApp: true, email: true, sms: false };
            return (
            <fieldset key={preference.category}>
              <legend>{preference.category.replaceAll('_', ' ')}</legend>
              {(['inApp', 'email', 'sms'] as const).map((field) => (
                <label key={field}>
                  <input
                    type="checkbox"
                    checked={preference[field]}
                    onChange={(event) => void updatePreference(preference.category, field, event.target.checked)}
                  />
                  {field === 'inApp' ? 'In-app' : field.toUpperCase()}
                </label>
              ))}
            </fieldset>
            );
          })}
        </details>
      </section>
    </details>
  );
}
