'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiDownload, apiRequest, apiUpload, setAccessToken } from '@/lib/api/client';
import { getFinanceSubmissionKey } from '@/lib/finance/submission';

type Branch = { id: string; name: string; code: string };
type Profile = { id: string; email: string | null; roles: string[]; permissions: string[] };
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
type StudentPayment = {
  id: string;
  amountMinor: number;
  method: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  reference: string | null;
  proofNotes: string | null;
  rejectionReason: string | null;
  createdAt: string;
  proofFileName: string | null;
  proofAvailable: boolean;
};
type StudentInvoice = {
  id: string;
  invoiceNumber: string;
  currency: string;
  status: string;
  issuedAt: string;
  dueAt: string | null;
  lines: Array<{ id: string; description: string; lineAmountMinor: number }>;
  payments: StudentPayment[];
  invoiceTotalMinor: number;
  verifiedPaymentsMinor: number;
  refundedMinor: number;
  balanceDueMinor: number;
};
type StudentTab = 'dashboard' | 'profile' | 'room' | 'fees' | 'complaints' | 'notifications';

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const meals = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
const studentTabs: Array<{ id: StudentTab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'profile', label: 'My Profile' },
  { id: 'room', label: 'My Room' },
  { id: 'fees', label: 'Fees & Payments' },
  { id: 'complaints', label: 'Complaints' },
  { id: 'notifications', label: 'Notifications' },
];

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency }).format(amountMinor / 100);
}

function studentPaymentStatus(status: StudentPayment['status']) {
  return status === 'VERIFIED' ? 'APPROVED' : status;
}

function currentMonday() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export default function StudentPortal() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [resident, setResident] = useState<Resident | null>(null);
  const [menu, setMenu] = useState<MenuEntry[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [invoices, setInvoices] = useState<StudentInvoice[]>([]);
  const [activeTab, setActiveTab] = useState<StudentTab>('dashboard');
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
        if (current.status === 401) router.replace('/login');
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
      router.replace('/login');
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
        router.replace('/login');
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
    if (!branchId) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    const response = await apiRequest<Complaint>(`/branches/${branchId}/complaints`, {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), description: description.trim(), priority: 'NORMAL' }),
    });
    setSubmitting(false);
    if (!response.ok) {
      if (response.status === 401) {
        router.replace('/login');
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
        router.replace('/login');
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
        router.replace('/login');
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
  const notifications = [
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
  ];

  async function signOut() {
    const response = await apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    if (!response.ok && response.status !== 401) {
      setError(`Could not sign out: ${response.message}`);
      return;
    }
    setAccessToken(null);
    router.replace('/login');
  }

  if (loading && !profile) return <main className="workspace-loading" aria-live="polite">Loading your student portal…</main>;

  return (
    <>
      <header className="workspace-header">
        <a className="brand" href="/">HMS <span>Student Portal</span></a>
        <div className="button-row">
          {branches.length > 1 && (
            <label>
              Hostel branch
              <select value={branchId} onChange={(event) => {
                setBranchId(event.target.value);
                sessionStorage.setItem('hms-branch', event.target.value);
              }}>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
          )}
          <button className="button secondary small" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>
      <main className="workspace-content">
        <div className="workspace-title">
          <div>
            <span className="eyebrow">STUDENT PORTAL</span>
            <h1>{resident ? `Welcome, ${resident.firstName}` : 'Welcome to your hostel'}</h1>
            <p>{branches.find((branch) => branch.id === branchId)?.name ?? 'Your hostel information'}</p>
          </div>
          {branches.length === 1 && <span className="count-pill">{branches[0].name}</span>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="success-message" role="status">{message}</p>}
        {branches.length === 0 && !loading && <section className="panel"><h2>No hostel branch assigned</h2><p>Please contact your hostel administration to finish setting up your student account.</p></section>}
        {branchId && loading && <section className="panel" aria-live="polite">Loading hostel information…</section>}
        {branchId && !loading && (
          <>
            <nav className="workspace-tabs student-tabs" aria-label="Student portal sections">
              {studentTabs.map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  className={activeTab === tab.id ? 'active' : ''}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                  {tab.id === 'notifications' && notifications.length > 0 && <span className="tab-count">{notifications.length}</span>}
                </button>
              ))}
            </nav>
            <div className="content-grid student-content-grid">
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
                <section className="panel student-section">
                  <div className="panel-heading"><div><h2>Fees & Payments</h2><p>Monthly rent, outstanding dues, and payment history.</p></div><strong>Outstanding: {formatMoney(outstandingMinor, invoices[0]?.currency ?? 'PKR')}</strong></div>
                  {!invoices.length ? <p className="empty-state">No invoices have been issued to your account.</p> : (
                    <div className="record-list">
                      {invoices.map((invoice) => {
                        const pendingMinor = invoice.payments
                          .filter((payment) => payment.status === 'PENDING')
                          .reduce((sum, payment) => sum + payment.amountMinor, 0);
                        const payableMinor = Math.max(invoice.balanceDueMinor - pendingMinor, 0);
                        return (
                          <article className="record student-invoice" key={invoice.id}>
                            <div className="record-main">
                              <div>
                                <h3>{invoice.invoiceNumber}</h3>
                                <p>Issued {new Date(invoice.issuedAt).toLocaleDateString()} · Due {invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString() : 'date not specified'}</p>
                                {invoice.lines.map((line) => <p key={line.id}>{line.description} · {formatMoney(line.lineAmountMinor, invoice.currency)}</p>)}
                              </div>
                              <span className={`status ${invoice.balanceDueMinor > 0 ? 'pending' : 'paid'}`}>
                                {invoice.status === 'VOID' ? 'VOID' : invoice.balanceDueMinor > 0 ? 'DUE' : 'PAID'}
                              </span>
                            </div>
                            <p><strong>Total:</strong> {formatMoney(invoice.invoiceTotalMinor, invoice.currency)} · <strong>Paid:</strong> {formatMoney(invoice.verifiedPaymentsMinor, invoice.currency)} · <strong>Balance:</strong> {formatMoney(invoice.balanceDueMinor, invoice.currency)}</p>
                            {invoice.payments.length > 0 && (
                              <div className="payment-history">
                                <h4>Payment history & proof status</h4>
                                {invoice.payments.map((payment) => (
                                  <div className="payment-row" key={payment.id}>
                                    <div>
                                      <strong>{formatMoney(payment.amountMinor, invoice.currency)}</strong> · {payment.method.replace('_', ' ')} · <span className={`status ${payment.status.toLowerCase()}`}>{studentPaymentStatus(payment.status)}</span>
                                      {payment.reference && <p>Reference: {payment.reference}</p>}
                                      {payment.rejectionReason && <p className="form-error">Rejected: {payment.rejectionReason}</p>}
                                    </div>
                                    {payment.proofAvailable && <button className="button secondary small" type="button" disabled={downloadingPaymentId === payment.id} onClick={() => void downloadPaymentProof(payment)}>
                                      {downloadingPaymentId === payment.id ? 'Downloading…' : 'Download receipt'}
                                    </button>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {invoice.status === 'ISSUED' && payableMinor > 0 && (
                              <details className="finance-action">
                                <summary>Upload payment proof · up to {formatMoney(payableMinor, invoice.currency)}</summary>
                                <form className="stack-form" onSubmit={(event) => void submitPayment(event, invoice)}>
                                  <label>Amount paid<input name="amount" required type="number" min={0.01} max={payableMinor / 100} step={0.01} /></label>
                                  <label>Payment method<select name="method" defaultValue="BANK_TRANSFER"><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option><option value="CASH">Cash</option></select></label>
                                  <label>Transaction reference<input name="reference" maxLength={200} /></label>
                                  <label>Notes<textarea name="proofNotes" maxLength={1000} rows={2} /></label>
                                  <label>Screenshot / receipt<input name="proof" required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
                                  <p className="muted">JPEG, PNG, WebP or PDF · maximum 5 MB.</p>
                                  <button className="button primary" type="submit" disabled={paymentSubmittingId === invoice.id}>
                                    {paymentSubmittingId === invoice.id ? 'Submitting…' : 'Submit payment for verification'}
                                  </button>
                                </form>
                              </details>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
              {activeTab === 'complaints' && (
                <>
                  <section className="panel">
                    <h2>Submit a complaint</h2>
                    <p>Only you and authorized hostel staff can view your complaint.</p>
                    <form className="stack-form" onSubmit={submitComplaint}>
                      <label>Subject<input required maxLength={150} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                      <label>Details<textarea required maxLength={5000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
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
                  <div className="panel-heading"><div><h2>Notifications</h2><p>Rent reminders and hostel announcements.</p></div><span className="count-pill">{notifications.length}</span></div>
                  {!notifications.length ? <p className="empty-state">There are no current notifications.</p> : (
                    <div className="record-list">
                      {notifications.map((notification) => (
                        <article className="record" key={notification.id}>
                          <div className="record-main"><div><h3>{notification.title}</h3><p>{notification.body}</p></div>{notification.urgent && <span className="status rejected">OVERDUE</span>}</div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
