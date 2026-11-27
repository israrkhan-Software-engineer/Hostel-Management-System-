'use client';

import { SyntheticEvent, useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api/client';
import Icon from './ui/icon';

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
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [seenOnOpenIds, setSeenOnOpenIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 9000);
    return () => clearTimeout(timer);
  }, [error]);

  const load = useCallback(async () => {
    const [notificationsResult, preferencesResult] = await Promise.all([
      apiRequest<NotificationItem[] | { items: NotificationItem[] }>('/notifications'),
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
    const rawData = notificationsResult.data;
    const notificationList = Array.isArray(rawData)
      ? rawData
      : Array.isArray((rawData as { items?: NotificationItem[] })?.items)
        ? (rawData as { items: NotificationItem[] }).items
        : [];
    setItems(notificationList);
    setPreferences(Array.isArray(preferencesResult.data) ? preferencesResult.data : []);
    setError('');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    setBusy(true);
    const result = await apiRequest<{ updated: number }>('/notifications/read-all', { method: 'POST' });
    if (!result.ok) {
      setError(result.message);
    } else {
      await load();
    }
    setBusy(false);
  }

  async function markRead(id: string) {
    setBusy(true);
    const result = await apiRequest<NotificationItem>(`/notifications/${id}/read`, { method: 'PATCH' });
    if (!result.ok) {
      setError(result.message);
    } else {
      setItems((current) => current.map((item) => (item.id === id ? result.data : item)));
    }
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

  const safeItems = Array.isArray(items) ? items : [];
  const unreadItems = safeItems.filter((item) => !item.readAt);
  const unreadCount = unreadItems.length;
  // On visit, show newly arrived unread notifications (including those just opened in this visit)
  const displayedItems = filter === 'unread'
    ? safeItems.filter((item) => !item.readAt || seenOnOpenIds.includes(item.id))
    : safeItems;

  async function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const isOpen = event.currentTarget.open;
    if (isOpen) {
      if (unreadItems.length > 0) {
        const idsToMark = unreadItems.map((item) => item.id);
        setSeenOnOpenIds(idsToMark);
        const now = new Date().toISOString();
        setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt: now })));
        const result = await apiRequest<{ updated: number }>('/notifications/read-all', { method: 'POST' });
        if (!result.ok) {
          setError(result.message);
        }
      }
    } else if (seenOnOpenIds.length > 0) {
      setSeenOnOpenIds([]);
    }
  }

  return (
    <details className="notification-center" onToggle={(event) => void handleToggle(event)}>
      <summary aria-label={`${unreadCount} unread notifications`}>
        Notifications{unreadCount ? <span className="notification-count">{unreadCount}</span> : null}
      </summary>
      <section className="notification-panel" aria-label="Notifications and preferences">
        <div className="notification-panel-heading">
          <div>
            <h2>Notifications</h2>
            <p>{unreadCount} unread notification{unreadCount === 1 ? '' : 's'}</p>
          </div>
          <div className="notification-actions">
            <div className="notification-tab-filters" role="tablist" aria-label="Notification view">
              <button
                type="button"
                className={`button small ${filter === 'unread' ? 'primary' : 'secondary'}`}
                onClick={() => setFilter('unread')}
                role="tab"
                aria-selected={filter === 'unread'}
              >
                Unread ({unreadCount})
              </button>
              <button
                type="button"
                className={`button small ${filter === 'all' ? 'primary' : 'secondary'}`}
                onClick={() => setFilter('all')}
                role="tab"
                aria-selected={filter === 'all'}
              >
                All ({items.length})
              </button>
            </div>
            {unreadCount > 0 && (
              <button
                className="button secondary small"
                type="button"
                disabled={busy}
                onClick={() => void markAllRead()}
              >
                Mark all read
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            <Icon name="alert" size={18} />
            <span style={{ flex: 1 }}>{error}</span>
            <button type="button" className="notice-close" onClick={() => setError('')} aria-label="Dismiss error">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        {!displayedItems.length ? (
          <p className="empty-state">
            {filter === 'unread' ? 'No new unread notifications.' : 'No notifications yet.'}
          </p>
        ) : (
          <ul className="notification-list">
            {displayedItems.map((item) => (
              <li
                key={item.id}
                className={`notification-item ${item.readAt ? 'read' : 'unread'}`}
                onClick={() => {
                  if (!item.readAt && !busy) {
                    void markRead(item.id);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !item.readAt && !busy) {
                    e.preventDefault();
                    void markRead(item.id);
                  }
                }}
              >
                <div className="notification-item-content">
                  <div className="notification-item-header">
                    <strong className="notification-title">{item.title}</strong>
                    {!item.readAt && <span className="unread-dot" title="Unread" />}
                  </div>
                  <p className="notification-body">{item.body}</p>
                  <div className="notification-meta">
                    <span className="notification-category">{item.category.replace('_', ' ')}</span>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                  </div>
                </div>
                {!item.readAt && (
                  <button
                    className="button secondary small notification-mark-btn"
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void markRead(item.id);
                    }}
                  >
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
