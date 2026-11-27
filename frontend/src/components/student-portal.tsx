'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiDownload, apiRequest, apiUpload, setAccessToken } from '@/lib/api/client';
import { useOnlineStatus } from '@/lib/hooks/use-online-status';
import { formatStudentMoney as formatMoney } from '@/lib/portal/format';
import type { StudentInvoice, StudentPayment } from '@/lib/portal/types';
import { getFinanceSubmissionKey } from '@/lib/finance/submission';
import AccountSecurityPanel from './account-security-panel';
import HostelServicesPanel from './hostel-services-panel';
import NotificationCenter from './notification-center';
import StudentFeesPanel from './student-fees-panel';
import ThemeToggle from './ui/theme-toggle';
import { Icon } from './ui/icon';
import {
  addQueuedComplaint,
  complaintOutboxKey,
  markQueuedComplaintFailed,
  readComplaintOutbox,
  removeQueuedComplaint,
  type QueuedComplaint,
} from '@/lib/offline/complaint-outbox';

type Branch = { id: string; name: string; code: string };
type Profile = {
  id: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  mfaEnabled: boolean;
};
type Resident = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  cnicMasked: string | null;
  accountLinked: boolean;
  dateOfBirth: string | null;
  room: {
    building: string;
    floor: string;
    room: string;
    bed: string;
    allocationStatus: string;
    checkedInAt: string | null;
  } | null;
};
type EditableResidentProfile = Pick<Resident, 'firstName' | 'lastName' | 'phone' | 'dateOfBirth'>;
type MenuEntry = { dayOfWeek: number; meal: 'BREAKFAST' | 'LUNCH' | 'DINNER'; description: string };
type MessMenu = { entries: MenuEntry[] };
type Complaint = {
  id: string;
  title: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: string;
  createdAt: string;
};
type Notice = { id: string; title: string; body: string; startsAt: string | null; endsAt: string | null };
type StudentTab = 'dashboard' | 'profile' | 'room' | 'fees' | 'complaints' | 'notifications' | 'services' | 'settings';

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const meals = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
const studentTabs: Array<{ id: StudentTab; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'profile', label: 'My Profile', icon: 'users' },
  { id: 'room', label: 'My Room', icon: 'bed' },
  { id: 'fees', label: 'Fees & Payments', icon: 'receipt' },
  { id: 'complaints', label: 'Complaints', icon: 'alert' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'services', label: 'Student services', icon: 'check' },
  { id: 'settings', label: 'Settings', icon: 'shield' },
];

function studentLoginPath() {
  const slug = typeof window === 'undefined'
    ? ''
    : new URLSearchParams(window.location.search).get('hostel')?.trim() ?? '';
  return slug ? `/student-login?hostel=${encodeURIComponent(slug)}` : '/student-login';
}

function currentMonday() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function createMutationId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function complaintSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export default function StudentPortal() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [resident, setResident] = useState<Resident | null>(null);
  const [menu, setMenu] = useState<MenuEntry[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [queuedComplaints, setQueuedComplaints] = useState<QueuedComplaint[]>([]);
  const isOnline = useOnlineStatus();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [invoices, setInvoices] = useState<StudentInvoice[]>([]);
  const [seenNotificationIds, setSeenNotificationIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<StudentTab>('dashboard');
  const [settingsTab, setSettingsTab] = useState<'security' | 'profile' | 'notifications' | 'display'>('security');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<EditableResidentProfile>({
    firstName: '',
    lastName: '',
    phone: null,
    dateOfBirth: null,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [paymentSubmittingId, setPaymentSubmittingId] = useState('');
  const [downloadingPaymentId, setDownloadingPaymentId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const weekStart = useMemo(currentMonday, []);
  const loadRequestId = useRef(0);
  const paymentSubmissionKeys = useRef(new Map<string, { signature: string; key: string }>());

  useEffect(() => {
    let active = true;
    async function initialize() {
      const current = await apiRequest<Profile>('/auth/profile');
      if (!active) return;
      if (!current.ok) {
        if (current.status === 401) router.replace(studentLoginPath());
        else setError(current.message);
        setLoading(false);
        return;
      }
      if (!current.data.roles.includes('Resident')) {
        router.replace('/reception');
        return;
      }
      setProfile(current.data);
      const response = await apiRequest<Branch[]>('/branches');
      if (!active) return;
      if (!response.ok) {
        setError(response.message);
        setLoading(false);
        return;
      }
      setBranches(response.data);
      const remembered = sessionStorage.getItem('hms-branch') ?? '';
      setBranchId(response.data.some(({ id }) => id === remembered) ? remembered : response.data[0]?.id ?? '');
      if (!response.data.length) setLoading(false);
    }
    void initialize();
    return () => { active = false; };
  }, [router]);

  const loadBranch = useCallback(async () => {
    if (!branchId || !profile) return;
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError('');
    setResident(null);
    setMenu([]);
    setComplaints([]);
    setNotices([]);
    setInvoices([]);
    const base = `/branches/${branchId}`;
    const [residentResponse, menuResponse, complaintResponse, noticeResponse, invoiceResponse] = await Promise.all([
      apiRequest<Resident>(`${base}/residents/me`),
      apiRequest<MessMenu>(`${base}/mess-menus?weekStart=${weekStart}`),
      apiRequest<Complaint[]>(`${base}/complaints`),
      apiRequest<Notice[]>(`${base}/notices`),
      apiRequest<StudentInvoice[]>(`${base}/resident/finance`),
    ]);
    if (requestId !== loadRequestId.current) return;

    const responses = [residentResponse, menuResponse, complaintResponse, noticeResponse, invoiceResponse];
    if (responses.some((response) => !response.ok && response.status === 401)) {
      router.replace(studentLoginPath());
      setLoading(false);
      return;
    }

    const failures = responses.filter((response) => !response.ok && response.status !== 404);
    if (failures.length) setError(failures.map((response) => !response.ok ? response.message : '').join('; '));
    if (residentResponse.ok) setResident(residentResponse.data);
    else if (residentResponse.status === 404) setResident(null);
    if (menuResponse.ok) setMenu(menuResponse.data.entries);
    if (complaintResponse.ok) setComplaints(complaintResponse.data);
    if (noticeResponse.ok) setNotices(noticeResponse.data);
    if (invoiceResponse.ok) setInvoices(invoiceResponse.data);
    setLoading(false);
  }, [branchId, profile, router, weekStart]);

  useEffect(() => () => {
    loadRequestId.current += 1;
  }, []);

  useEffect(() => {
    if (!profile || !branchId) return;
    const key = complaintOutboxKey(profile.id, branchId);
    const storage = complaintSessionStorage();
    if (!storage) {
      setError('Browser session storage is unavailable; queued complaints cannot be read or synced.');
      return;
    }
    const stored = readComplaintOutbox(storage, key);
    setQueuedComplaints(stored.items);
    if (stored.error) {
      setError(stored.error);
      return;
    }
    if (!isOnline || !stored.items.length) return;

    let active = true;
    void (async () => {
      let remaining = stored.items;
      let synced = 0;
      for (const complaint of stored.items) {
        const response = await apiRequest<Complaint>(`/branches/${branchId}/complaints`, {
          method: 'POST',
          body: JSON.stringify({
            title: complaint.title,
            description: complaint.description,
            priority: complaint.priority,
            clientMutationId: complaint.clientMutationId,
          }),
        });
        if (response.ok) {
          const result = removeQueuedComplaint(storage, key, complaint.clientMutationId);
          remaining = result.items;
          if (result.error) {
            if (active) setError(result.error);
            break;
          }
          synced += 1;
          continue;
        }
        if (response.status === 401) {
          router.replace(studentLoginPath());
          break;
        }
        if (response.status === 0 || response.status >= 500) break;
        const result = markQueuedComplaintFailed(
          storage,
          key,
          complaint.clientMutationId,
          response.message,
        );
        remaining = result.items;
        if (result.error) {
          if (active) setError(result.error);
          break;
        }
      }
      if (!active) return;
      setQueuedComplaints(remaining);
      if (synced) {
        setMessage(`${synced} queued complaint${synced === 1 ? '' : 's'} synced.`);
        await loadBranch();
      }
    })();
    return () => { active = false; };
  }, [branchId, isOnline, loadBranch, profile, router]);

  useEffect(() => {
    void loadBranch();
  }, [loadBranch]);

  function startEditingProfile() {
    if (!resident) return;
    setProfileForm({
      firstName: resident.firstName,
      lastName: resident.lastName,
      phone: resident.phone,
      dateOfBirth: resident.dateOfBirth?.slice(0, 10) ?? null,
    });
    setEditingProfile(true);
    setError('');
    setMessage('');
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId) return;
    setSavingProfile(true);
    setError('');
    setMessage('');
    const response = await apiRequest<Pick<Resident, 'firstName' | 'lastName' | 'phone' | 'dateOfBirth'>>(
      `/branches/${branchId}/residents/me`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: profileForm.firstName.trim(),
          lastName: profileForm.lastName.trim(),
          phone: profileForm.phone?.trim() || null,
          dateOfBirth: profileForm.dateOfBirth || null,
        }),
      },
    );
    setSavingProfile(false);
    if (!response.ok) {
      if (response.status === 401) {
        router.replace(studentLoginPath());
        return;
      }
      setError(response.message);
      return;
    }
    setResident((current) => current ? { ...current, ...response.data } : current);
    setEditingProfile(false);
    setMessage('Your profile has been updated.');
  }

  async function submitComplaint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !profile) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    let clientMutationId: string;
    try {
      clientMutationId = createMutationId();
    } catch {
      setSubmitting(false);
      setError('Secure random IDs are unavailable; the complaint was not sent or queued.');
      return;
    }
    const queuedComplaint: QueuedComplaint = {
      clientMutationId,
      title: title.trim(),
      description: description.trim(),
      priority: 'NORMAL',
      queuedAt: new Date().toISOString(),
    };
    if (!isOnline) {
      const key = complaintOutboxKey(profile?.id ?? '', branchId);
      const storage = complaintSessionStorage();
      if (!storage) {
        setSubmitting(false);
        setError('Browser session storage is unavailable; the complaint was not queued.');
        return;
      }
      const result = addQueuedComplaint(storage, key, queuedComplaint);
      setSubmitting(false);
      setQueuedComplaints(result.items);
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle('');
      setDescription('');
      setMessage('Complaint queued in this browser session; it will sync when you reconnect.');
      return;
    }
    const response = await apiRequest<Complaint>(`/branches/${branchId}/complaints`, {
      method: 'POST',
      body: JSON.stringify({
        title: queuedComplaint.title,
        description: queuedComplaint.description,
        priority: queuedComplaint.priority,
        clientMutationId,
      }),
    });
    setSubmitting(false);
    if (!response.ok) {
      if (response.status === 401) {
        router.replace(studentLoginPath());
        return;
      }
      if (response.status === 0 || response.status >= 500) {
        const key = complaintOutboxKey(profile?.id ?? '', branchId);
        const storage = complaintSessionStorage();
        if (!storage) {
          setError(`${response.message} Browser session storage is unavailable; the complaint was not queued.`);
          return;
        }
        const result = addQueuedComplaint(storage, key, queuedComplaint);
        setQueuedComplaints(result.items);
        if (result.error) {
          setError(`${response.message} The complaint could not be queued: ${result.error}`);
          return;
        }
        setTitle('');
        setDescription('');
        setMessage('Connection failed; complaint queued in this browser session for retry.');
        return;
      }
      setError(response.message);
      return;
    }
    setTitle('');
    setDescription('');
    setMessage('Your complaint has been submitted.');
    await loadBranch();
  }

  function discardQueuedComplaint(clientMutationId: string) {
    if (!profile || !branchId) return;
    const storage = complaintSessionStorage();
    if (!storage) {
      setError('Browser session storage is unavailable; the queued complaint was not removed.');
      return;
    }
    const result = removeQueuedComplaint(
      storage,
      complaintOutboxKey(profile.id, branchId),
      clientMutationId,
    );
    setQueuedComplaints(result.items);
    if (result.error) setError(result.error);
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>, invoice: StudentInvoice) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('proof');
    const amount = Number(data.get('amount'));
    if (!(file instanceof File) || !file.size) {
      setError('Choose a payment screenshot or receipt before submitting.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid payment amount.');
      return;
    }
    const amountMinor = Math.round(amount * 100);
    const method = String(data.get('method'));
    const reference = String(data.get('reference') ?? '').trim();
    const proofNotes = String(data.get('proofNotes') ?? '').trim();
    const key = getFinanceSubmissionKey(paymentSubmissionKeys.current, invoice.id, {
      amountMinor,
      method,
      reference,
      proofNotes,
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
    });
    const formData = new FormData();
    formData.set('amountMinor', String(amountMinor));
    formData.set('method', method);
    formData.set('submissionKey', key);
    if (reference) formData.set('reference', reference);
    if (proofNotes) formData.set('proofNotes', proofNotes);
    formData.set('proof', file);

    setPaymentSubmittingId(invoice.id);
    setError('');
    setMessage('');
    const response = await apiUpload<StudentInvoice>(
      `/branches/${branchId}/resident/invoices/${invoice.id}/payments`,
      formData,
    );
    setPaymentSubmittingId('');
    if (!response.ok) {
      if (response.status === 401) {
        router.replace(studentLoginPath());
        return;
      }
      setError(response.message);
      return;
    }
    form.reset();
    paymentSubmissionKeys.current.delete(invoice.id);
    setMessage('Payment proof submitted. It will show as Pending until hostel staff review it.');
    await loadBranch();
  }

  async function downloadPaymentProof(payment: StudentPayment) {
    setDownloadingPaymentId(payment.id);
    setError('');
    const response = await apiDownload(
      `/branches/${branchId}/resident/payments/${payment.id}/proof`,
    );
    setDownloadingPaymentId('');
    if (!response.ok) {
      if (response.status === 401) {
        router.replace(studentLoginPath());
        return;
      }
      setError(response.message);
      return;
    }
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = payment.proofFileName ?? 'payment-proof';
    link.click();
    URL.revokeObjectURL(url);
  }

  const outstandingMinor = invoices.reduce(
    (total, invoice) => total + (invoice.status === 'ISSUED' ? invoice.balanceDueMinor : 0),
    0,
  );
  const pendingPaymentsCount = invoices.reduce(
    (total, invoice) => total + invoice.payments.filter((payment) => payment.status === 'PENDING').length,
    0,
  );
  const notifications = useMemo(() => [
    ...invoices.flatMap((invoice) => {
      if (invoice.status !== 'ISSUED' || invoice.balanceDueMinor <= 0) return [];
      const overdue = Boolean(invoice.dueAt && new Date(invoice.dueAt).getTime() < Date.now());
      const dueDate = invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString() : 'Not specified';
      return [{
        id: `invoice-${invoice.id}`,
        title: overdue ? `Overdue payment · ${invoice.invoiceNumber}` : `Rent/payment due · ${invoice.invoiceNumber}`,
        body: `${formatMoney(invoice.balanceDueMinor, invoice.currency)} outstanding. Due date: ${dueDate}.`,
        urgent: overdue,
      }];
    }),
    ...notices.map((notice) => ({
      id: `notice-${notice.id}`,
      title: notice.title,
      body: notice.body,
      urgent: false,
    })),
  ], [invoices, notices]);

  const seenStorageKey = profile?.id && branchId ? `hms-student-seen-notifications:${profile.id}:${branchId}` : '';

  useEffect(() => {
    if (!seenStorageKey) {
      setSeenNotificationIds([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(seenStorageKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      setSeenNotificationIds(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
    } catch {
      setSeenNotificationIds([]);
    }
  }, [seenStorageKey]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((item) => !seenNotificationIds.includes(item.id)).length,
    [notifications, seenNotificationIds],
  );

  function markAllNotificationsRead() {
    if (!notifications.length) return;
    const allIds = notifications.map((item) => item.id);
    setSeenNotificationIds((current) => {
      const merged = Array.from(new Set([...current, ...allIds]));
      if (seenStorageKey) {
        try {
          window.localStorage.setItem(seenStorageKey, JSON.stringify(merged));
        } catch {
          // ignore storage quota errors
        }
      }
      return merged;
    });
    setMessage('All messages marked as read.');
  }

  const formattedToday = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }, []);

  const currentBranch = useMemo(() => {
    return branches.find((branch) => branch.id === branchId) ?? branches[0] ?? null;
  }, [branches, branchId]);

  const studentInitials = useMemo(() => {
    if (resident?.firstName && resident?.lastName) {
      return `${resident.firstName[0]}${resident.lastName[0]}`.toUpperCase();
    }
    if (resident?.firstName) return resident.firstName.slice(0, 2).toUpperCase();
    if (profile?.email) return profile.email.slice(0, 2).toUpperCase();
    return 'ST';
  }, [resident, profile]);

  async function signOut() {
    const response = await apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    if (!response.ok && response.status !== 401) {
      setError(`Could not sign out: ${response.message}`);
      return;
    }
    setAccessToken(null);
    router.replace(studentLoginPath());
  }

  if (loading && !profile) return <main className="workspace-loading" aria-live="polite">Loading your student portal…</main>;

  return (
    <div className="workspace-layout">
      {/* Abmanix Dark Ink Sidebar for Student Portal */}
      <aside className="workspace-sidebar" aria-label="Student portal navigation">
        <div className="sidebar-brand-block">
          <Link className="sidebar-brand-info" href="/">
            <span className="sidebar-brand-mark">H</span>
            <div className="sidebar-brand-text">
              <strong>{currentBranch ? currentBranch.name : 'Hostel Operations'}</strong>
              <span>Student Portal</span>
            </div>
          </Link>
        </div>

        <div className="sidebar-section-heading">STUDENT PORTAL</div>
        {studentTabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={`sidebar-nav-btn${activeTab === tab.id ? ' active' : ''}`}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            <Icon name={tab.icon} size={16} />
            {tab.label}
            {tab.id === 'notifications' && unreadNotificationsCount > 0 && (
              <span className="count-pill" style={{ marginLeft: 'auto', fontSize: '11px', padding: '2px 7px' }}>
                {unreadNotificationsCount}
              </span>
            )}
          </button>
        ))}

        <div className="sidebar-footer-card">
          <div className="sidebar-user-pill">
            <div className="sidebar-user-avatar">{studentInitials}</div>
            <div className="sidebar-user-info">
              <strong>{resident ? `${resident.firstName} ${resident.lastName}` : profile?.email?.split('@')[0] || 'Student'}</strong>
              <span>Resident</span>
            </div>
            <button
              type="button"
              className="icon-btn"
              style={{ width: '28px', height: '28px' }}
              onClick={() => void signOut()}
              title="Sign out"
              aria-label="Sign out"
            >
              <Icon name="signout" size={14} />
            </button>
          </div>
          <div className="sidebar-powered-by">Powered by HMS Operations</div>
        </div>
      </aside>

      {/* Main Center Workspace Area */}
      <div className="workspace-main-area">
        <header className="workspace-topbar">
          <div className="topbar-date">{formattedToday}</div>
          <div className="topbar-right-actions">
            {isOnline ? (
              <span className="sync-status-badge">
                <span className="sync-status-dot" />
                Online
              </span>
            ) : (
              <span className="status danger">Offline Mode</span>
            )}
            <ThemeToggle />
            <NotificationCenter />
            {branches.length > 1 && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', margin: 0, fontWeight: 600 }}>
                Hostel branch
                <select
                  className="field-inline"
                  style={{ width: 'auto', minWidth: '150px', padding: '6px 10px', fontSize: '13px' }}
                  value={branchId}
                  onChange={(event) => {
                    setBranchId(event.target.value);
                    sessionStorage.setItem('hms-branch', event.target.value);
                  }}
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </header>

        <main className="workspace-content">
          <div className="workspace-title">
            <div>
              <span className="eyebrow">STUDENT PORTAL</span>
              <h1>{resident ? `Welcome, ${resident.firstName}` : 'Welcome to your hostel'}</h1>
              <p>{currentBranch?.name ?? 'Your hostel information'}</p>
            </div>
            {branches.length === 1 && <span className="count-pill">{branches[0].name}</span>}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="success-message" role="status">{message}</p>}
          {branches.length === 0 && !loading && (
            <section className="panel">
              <h2>No hostel branch assigned</h2>
              <p>Please contact your hostel administration to finish setting up your student account.</p>
            </section>
          )}
          {branchId && loading && <section className="panel" aria-live="polite">Loading hostel information…</section>}
          {branchId && !loading && (
            <div className="content-grid student-content-grid">
              {activeTab === 'services' && (
                <div className="student-section">
                  <HostelServicesPanel
                    mode="student"
                    branchId={branchId}
                    permissions={profile?.permissions ?? []}
                  />
                </div>
              )}
              {activeTab === 'dashboard' && (
                <>
                  <section className="student-metrics">
                    <article><span>Outstanding rent & fees</span><strong>{formatMoney(outstandingMinor, invoices[0]?.currency ?? 'PKR')}</strong></article>
                    <article><span>Invoices</span><strong>{invoices.filter((invoice) => invoice.status === 'ISSUED').length}</strong></article>
                    <article><span>Payments awaiting review</span><strong>{pendingPaymentsCount}</strong></article>
                    <article><span>Important notifications</span><strong>{notifications.length}</strong></article>
                  </section>
                  <section className="panel grow">
                    <div className="panel-heading">
                      <div><h2>Important notifications</h2><p>Rent reminders and hostel announcements.</p></div>
                      <button type="button" className="quiet-link" onClick={() => setActiveTab('notifications')}>View all</button>
                    </div>
                    {!notifications.length ? <p className="empty-state">You’re all caught up.</p> : (
                      <div className="record-list">
                        {notifications.slice(0, 4).map((notification) => (
                          <article className="record" key={notification.id}>
                            <h3>{notification.title}</h3><p>{notification.body}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="panel grow">
                    <div className="panel-heading"><div><h2>This week’s mess menu</h2><p>Week beginning {weekStart}.</p></div></div>
                    {!menu.length ? <p className="empty-state">No menu has been published for this week.</p> : (
                      <div className="record-list">
                        {dayNames.map((day, index) => {
                          const entries = meals.map((meal) => menu.find((entry) => entry.dayOfWeek === index + 1 && entry.meal === meal)).filter(Boolean);
                          return entries.length ? (
                            <article className="record" key={day}>
                              <h3>{day}</h3>
                              {entries.map((entry) => <p key={entry!.meal}><strong>{entry!.meal.toLowerCase()}:</strong> {entry!.description}</p>)}
                            </article>
                          ) : null;
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
              {activeTab === 'profile' && (
                <section className="panel student-section">
                  <div className="panel-heading">
                    <div><h2>My Profile</h2><p>Keep your personal details up to date.</p></div>
                    {resident && !editingProfile && (
                      <button className="button secondary small" type="button" onClick={startEditingProfile}>
                        Edit profile
                      </button>
                    )}
                  </div>
                  {resident ? (
                    editingProfile ? (
                      <form className="stack-form profile-edit-form" onSubmit={(event) => void saveProfile(event)}>
                        <div className="two-fields">
                          <label>First name<input required maxLength={100} value={profileForm.firstName} onChange={(event) => setProfileForm((current) => ({ ...current, firstName: event.target.value }))} /></label>
                          <label>Last name<input required maxLength={100} value={profileForm.lastName} onChange={(event) => setProfileForm((current) => ({ ...current, lastName: event.target.value }))} /></label>
                        </div>
                        <div className="two-fields">
                          <label>Phone<input type="tel" maxLength={30} value={profileForm.phone ?? ''} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} /></label>
                          <label>Date of birth<input type="date" value={profileForm.dateOfBirth ?? ''} onChange={(event) => setProfileForm((current) => ({ ...current, dateOfBirth: event.target.value }))} /></label>
                        </div>
                        <div className="button-row">
                          <button className="button primary" type="submit" disabled={savingProfile}>
                            {savingProfile ? 'Saving…' : 'Save changes'}
                          </button>
                          <button className="button secondary" type="button" disabled={savingProfile} onClick={() => setEditingProfile(false)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <dl className="student-details">
                        <div><dt>Full name</dt><dd>{resident.firstName} {resident.lastName}</dd></div>
                        <div><dt>Email</dt><dd>{resident.email ?? profile?.email ?? 'Not provided'}</dd></div>
                        <div><dt>Phone</dt><dd>{resident.phone ?? 'Not provided'}</dd></div>
                        <div><dt>Date of birth</dt><dd>{resident.dateOfBirth ? new Date(`${resident.dateOfBirth.slice(0, 10)}T00:00:00`).toLocaleDateString() : 'Not provided'}</dd></div>
                        <div><dt>CNIC</dt><dd>{resident.cnicMasked ?? 'Not provided'}</dd></div>
                        <div><dt>Resident status</dt><dd><span className={`status ${resident.status.toLowerCase()}`}>{resident.status}</span></dd></div>
                      </dl>
                    )
                  ) : <p className="empty-state">Your login is not linked to a resident record. Please contact hostel staff.</p>}
                  {resident && !editingProfile && <p className="muted">Email, CNIC, resident status, and room assignment can only be changed by hostel staff.</p>}
                </section>
              )}
              {activeTab === 'room' && (
                <section className="panel student-section">
                  <h2>My Room</h2>
                  {resident?.room ? (
                    <dl className="student-details">
                      <div><dt>Hostel branch</dt><dd>{branches.find((branch) => branch.id === branchId)?.name}</dd></div>
                      <div><dt>Building</dt><dd>{resident.room.building}</dd></div>
                      <div><dt>Floor</dt><dd>{resident.room.floor}</dd></div>
                      <div><dt>Room</dt><dd>{resident.room.room}</dd></div>
                      <div><dt>Bed</dt><dd>{resident.room.bed}</dd></div>
                      <div><dt>Allocation</dt><dd><span className={`status ${resident.room.allocationStatus.toLowerCase()}`}>{resident.room.allocationStatus.replace('_', ' ')}</span></dd></div>
                    </dl>
                  ) : <p className="empty-state">No active room or bed allocation is linked to your resident record.</p>}
                </section>
              )}
              {activeTab === 'fees' && (
                <StudentFeesPanel
                  invoices={invoices}
                  outstandingMinor={outstandingMinor}
                  downloadingPaymentId={downloadingPaymentId}
                  paymentSubmittingId={paymentSubmittingId}
                  onDownloadProof={(payment) => void downloadPaymentProof(payment)}
                  onSubmitPayment={(event, invoice) => void submitPayment(event, invoice)}
                />
              )}
              {activeTab === 'complaints' && (
                <>
                  {queuedComplaints.length > 0 && (
                    <section className="panel" aria-live="polite">
                      <div className="panel-heading">
                        <div>
                          <h2>Queued complaints</h2>
                          <p>Stored only for this browser session; synced when you reconnect. Review any error before retrying.</p>
                        </div>
                        <span className="count-pill">{queuedComplaints.length}</span>
                      </div>
                      <div className="record-list">
                        {queuedComplaints.map((queued) => (
                          <article className="record" key={queued.clientMutationId}>
                            <div className="record-main">
                              <div>
                                <h3>{queued.title}</h3>
                                <p>{queued.syncError || (isOnline ? 'Waiting to sync.' : 'Waiting for a connection.')}</p>
                              </div>
                              <button
                                className="button secondary small"
                                type="button"
                                onClick={() => discardQueuedComplaint(queued.clientMutationId)}
                              >
                                Discard
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}
                  <section className="panel">
                    <h2>Submit a complaint</h2>
                    <p>Only you and authorized hostel staff can view your complaint. Offline submissions are queued in this browser session.</p>
                    <form className="stack-form" onSubmit={submitComplaint}>
                      <label>Subject<input required maxLength={150} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                      <label>Details<textarea required maxLength={4000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
                      <button className="button primary" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit complaint'}</button>
                    </form>
                  </section>
                  <section className="panel grow">
                    <div className="panel-heading"><div><h2>My complaints</h2><p>Updates from hostel staff appear here.</p></div><span className="count-pill">{complaints.length}</span></div>
                    {!complaints.length ? <p className="empty-state">You haven’t submitted any complaints.</p> : (
                      <div className="record-list">
                        {complaints.map((complaint) => (
                          <article className="record" key={complaint.id}>
                            <div className="record-main"><div><h3>{complaint.title}</h3><p>{complaint.description}</p><p>{new Date(complaint.createdAt).toLocaleDateString()}</p></div><span className={`status ${complaint.status.toLowerCase()}`}>{complaint.status.replace('_', ' ')}</span></div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
              {activeTab === 'notifications' && (
                <section className="panel student-section">
                  <div className="panel-heading">
                    <div>
                      <h2>Notifications</h2>
                      <p>Rent reminders and hostel announcements.</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {unreadNotificationsCount > 0 && (
                        <button
                          type="button"
                          className="button primary small"
                          onClick={markAllNotificationsRead}
                        >
                          <Icon name="checkCircle" size={14} />
                          Read all messages
                        </button>
                      )}
                      <span className="count-pill">{unreadNotificationsCount > 0 ? `${unreadNotificationsCount} unread` : `${notifications.length} read`}</span>
                    </div>
                  </div>
                  {!notifications.length ? <p className="empty-state">There are no current notifications.</p> : (
                    <div className="record-list">
                      {notifications.map((notification) => {
                        const isUnread = !seenNotificationIds.includes(notification.id);
                        return (
                          <article className="record" key={notification.id}>
                            <div className="record-main">
                              <div>
                                <h3>{notification.title}</h3>
                                <p>{notification.body}</p>
                              </div>
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                {isUnread && <span className="status active">NEW</span>}
                                {notification.urgent && <span className="status rejected">OVERDUE</span>}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {activeTab === 'settings' && (
                <div className="settings-section-container" style={{ gridColumn: '1 / -1' }}>
                  <div className="dashboard-hero-row">
                    <div className="dashboard-hero-title">
                      <span className="eyebrow">CONFIGURATION</span>
                      <h1>Settings</h1>
                      <p>Manage your account security and preferences.</p>
                    </div>
                  </div>

                  {/* Settings Navigation Tabs */}
                  <div className="settings-tabs">
                    <button
                      type="button"
                      className={`settings-tab${settingsTab === 'security' ? ' active' : ''}`}
                      onClick={() => setSettingsTab('security')}
                    >
                      <Icon name="shield" size={16} />
                      Account Security
                    </button>
                    <button
                      type="button"
                      className={`settings-tab${settingsTab === 'profile' ? ' active' : ''}`}
                      onClick={() => setSettingsTab('profile')}
                    >
                      <Icon name="users" size={16} />
                      Profile Info
                    </button>
                    <button
                      type="button"
                      className={`settings-tab${settingsTab === 'notifications' ? ' active' : ''}`}
                      onClick={() => setSettingsTab('notifications')}
                    >
                      <Icon name="bell" size={16} />
                      Notifications
                    </button>
                    <button
                      type="button"
                      className={`settings-tab${settingsTab === 'display' ? ' active' : ''}`}
                      onClick={() => setSettingsTab('display')}
                    >
                      <Icon name="refresh" size={16} />
                      Display
                    </button>
                  </div>

                  {/* Security Tab */}
                  {settingsTab === 'security' && profile && (
                    <AccountSecurityPanel
                      mfaEnabled={profile.mfaEnabled}
                      onMfaEnabled={() => setProfile((current) => current ? { ...current, mfaEnabled: true } : current)}
                    />
                  )}

                  {/* Profile Tab */}
                  {settingsTab === 'profile' && (
                    <div className="settings-panel-grid">
                      <section className="panel security-card">
                        <div className="panel-heading">
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Icon name="users" size={18} />
                              <h2>Account Information</h2>
                            </div>
                            <p>Your student account details.</p>
                          </div>
                        </div>
                        <div className="settings-info-list">
                          <div className="settings-info-row">
                            <span className="settings-info-label">Name</span>
                            <span className="settings-info-value">{resident ? `${resident.firstName} ${resident.lastName}` : '—'}</span>
                          </div>
                          <div className="settings-info-row">
                            <span className="settings-info-label">Email</span>
                            <span className="settings-info-value">{profile?.email || '—'}</span>
                          </div>
                          <div className="settings-info-row">
                            <span className="settings-info-label">Phone</span>
                            <span className="settings-info-value">{resident?.phone || '—'}</span>
                          </div>
                          <div className="settings-info-row">
                            <span className="settings-info-label">CNIC</span>
                            <span className="settings-info-value">{resident?.cnicMasked || '—'}</span>
                          </div>
                          <div className="settings-info-row">
                            <span className="settings-info-label">MFA Status</span>
                            <span className={`status ${profile?.mfaEnabled ? 'active' : 'neutral'}`}>{profile?.mfaEnabled ? 'Enabled' : 'Disabled'}</span>
                          </div>
                          <div className="settings-info-row">
                            <span className="settings-info-label">Branch</span>
                            <span className="settings-info-value">{currentBranch?.name || 'No branch'}</span>
                          </div>
                        </div>
                      </section>

                      <section className="panel security-card">
                        <div className="panel-heading">
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Icon name="bed" size={18} />
                              <h2>Room Assignment</h2>
                            </div>
                            <p>Your current room and bed allocation.</p>
                          </div>
                        </div>
                        <div className="settings-info-list">
                          <div className="settings-info-row">
                            <span className="settings-info-label">Building</span>
                            <span className="settings-info-value">{resident?.room?.building || '—'}</span>
                          </div>
                          <div className="settings-info-row">
                            <span className="settings-info-label">Floor</span>
                            <span className="settings-info-value">{resident?.room?.floor || '—'}</span>
                          </div>
                          <div className="settings-info-row">
                            <span className="settings-info-label">Room</span>
                            <span className="settings-info-value">{resident?.room?.room || '—'}</span>
                          </div>
                          <div className="settings-info-row">
                            <span className="settings-info-label">Bed</span>
                            <span className="settings-info-value">{resident?.room?.bed || '—'}</span>
                          </div>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* Notifications Tab */}
                  {settingsTab === 'notifications' && (
                    <div className="settings-panel-grid">
                      <section className="panel security-card">
                        <div className="panel-heading">
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Icon name="bell" size={18} />
                              <h2>Notification Preferences</h2>
                            </div>
                            <p>Configure how and when you receive notifications.</p>
                          </div>
                        </div>
                        <div className="settings-info-list">
                          <div className="settings-toggle-row">
                            <div>
                              <strong>Fee Reminders</strong>
                              <p className="muted">Get notified about upcoming fee deadlines.</p>
                            </div>
                            <span className="status active">Active</span>
                          </div>
                          <div className="settings-toggle-row">
                            <div>
                              <strong>Complaint Updates</strong>
                              <p className="muted">Get notified when your complaints are resolved.</p>
                            </div>
                            <span className="status active">Active</span>
                          </div>
                          <div className="settings-toggle-row">
                            <div>
                              <strong>Hostel Announcements</strong>
                              <p className="muted">Receive hostel-wide notices and announcements.</p>
                            </div>
                            <span className="status active">Active</span>
                          </div>
                          <div className="settings-toggle-row">
                            <div>
                              <strong>Mess Menu Updates</strong>
                              <p className="muted">Get notified when the weekly mess menu changes.</p>
                            </div>
                            <span className="status active">Active</span>
                          </div>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* Display Tab */}
                  {settingsTab === 'display' && (
                    <div className="settings-panel-grid">
                      <section className="panel security-card">
                        <div className="panel-heading">
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Icon name="refresh" size={18} />
                              <h2>Display Settings</h2>
                            </div>
                            <p>Customize your portal appearance.</p>
                          </div>
                        </div>
                        <div className="settings-info-list">
                          <div className="settings-toggle-row">
                            <div>
                              <strong>Theme</strong>
                              <p className="muted">Switch between light and dark mode.</p>
                            </div>
                            <ThemeToggle />
                          </div>
                          <div className="settings-toggle-row">
                            <div>
                              <strong>Default Branch</strong>
                              <p className="muted">Select which branch loads by default.</p>
                            </div>
                            {branches.length > 0 && (
                              <select
                                className="field-inline"
                                style={{ width: 'auto', minWidth: '160px', padding: '6px 10px', fontSize: '13px' }}
                                value={branchId}
                                onChange={(event) => {
                                  setBranchId(event.target.value);
                                  sessionStorage.setItem('hms-branch', event.target.value);
                                }}
                              >
                                {branches.map((b) => (
                                  <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      </section>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
