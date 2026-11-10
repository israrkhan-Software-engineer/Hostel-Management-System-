'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiDownload, apiRequest, apiUpload } from '@/lib/api/client';

type ServicePermission = string;
type ServiceMode = 'staff' | 'student';
type Resident = { id: string; firstName: string; lastName: string; status: string };
type Bed = {
  id: string;
  code: string;
  room: {
    code: string;
    floor: { name: string | null; level: number; building: { name: string } };
  };
};
type AttendanceRecord = {
  id: string;
  attendanceDate: string;
  status: 'PRESENT' | 'ABSENT' | 'LEAVE';
  notes: string | null;
  resident?: Resident;
};
type AttendanceResult = {
  records: AttendanceRecord[];
  summary: { counts: Record<string, number>; total: number };
};
type LeaveRequest = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  decisionNote: string | null;
  resident?: Resident;
};
type GatePass = {
  id: string;
  exitAt: string;
  expectedReturnAt: string;
  actualReturnAt: string | null;
  reason: string;
  status: string;
  lateReturn: boolean;
  rejectionReason: string | null;
  resident?: Resident;
};
type MealAttendanceRecord = {
  id: string;
  mealDate: string;
  meal: 'BREAKFAST' | 'LUNCH' | 'DINNER';
  status: 'PRESENT' | 'ABSENT';
  resident?: Resident;
};
type MealAttendanceResult = {
  records: MealAttendanceRecord[];
  summary: Record<string, { present: number; absent: number }>;
};
type MealPlan = {
  id: string;
  name: string;
  monthlyAmountMinor: number;
  mealTypes: string[];
  isActive: boolean;
};
type MealSubscription = {
  id: string;
  startsOn: string;
  endsOn: string;
  status: string;
  deactivatedAt: string | null;
  resident?: Resident;
  plan: MealPlan;
};
type StudentDocument = {
  id: string;
  category: string;
  originalName: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
};
type RoomTransfer = {
  id: string;
  fromRoomCode: string;
  fromBedCode: string;
  toRoomCode: string;
  toBedCode: string;
  reason: string;
  transferredAt: string;
  resident: Resident;
};
type ServiceTab =
  | 'attendance'
  | 'leave'
  | 'gate-passes'
  | 'meal-attendance'
  | 'subscriptions'
  | 'documents'
  | 'transfers'
  | 'exports';

const mealTypes = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
const documentCategories = ['CNIC', 'B_FORM', 'PHOTO', 'ADMISSION', 'OTHER'] as const;
const attendanceStatuses = ['PRESENT', 'ABSENT', 'LEAVE'] as const;
const exportTypes = ['residents', 'admissions', 'attendance', 'finance'] as const;

function localDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function dateLabel(date: string) {
  return new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString();
}

function serviceTitle(tab: ServiceTab) {
  return {
    attendance: 'Attendance',
    leave: 'Leave requests',
    'gate-passes': 'Student gate passes',
    'meal-attendance': 'Meal attendance',
    subscriptions: 'Meal subscriptions',
    documents: 'Student documents',
    transfers: 'Room transfers',
    exports: 'Excel exports',
  }[tab];
}

function money(amountMinor: number) {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR' }).format(amountMinor / 100);
}

export default function HostelServicesPanel({
  mode,
  branchId,
  permissions = [],
}: {
  mode: ServiceMode;
  branchId: string;
  permissions?: ServicePermission[];
}) {
  const permissionSet = useMemo(() => new Set(permissions), [permissions]);
  const has = (module: string, action: string) => permissionSet.has(`${module}:${action}`);
  const tabs = useMemo(() => {
    const available: ServiceTab[] = [
      ...(has('attendance', 'view') ? ['attendance' as const] : []),
      ...(has('leave_requests', 'view') || has('leave_requests', 'create') ? ['leave' as const] : []),
      ...(has('gate_passes', 'view') || has('gate_passes', 'create') ? ['gate-passes' as const] : []),
      ...(has('meal_attendance', 'view') ? ['meal-attendance' as const] : []),
      ...(has('meal_subscriptions', 'view') ? ['subscriptions' as const] : []),
      ...(has('student_documents', 'view') || has('student_documents', 'create') ? ['documents' as const] : []),
      ...(mode === 'staff' && has('allocations', 'view') ? ['transfers' as const] : []),
      ...(mode === 'staff' && has('exports', 'export') ? ['exports' as const] : []),
    ];
    return available;
  }, [mode, permissionSet]);
  const [tab, setTab] = useState<ServiceTab>('attendance');
  const [residents, setResidents] = useState<Resident[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [attendance, setAttendance] = useState<AttendanceResult | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [gatePasses, setGatePasses] = useState<GatePass[]>([]);
  const [mealAttendance, setMealAttendance] = useState<MealAttendanceResult | null>(null);
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<MealSubscription[]>([]);
  const [documents, setDocuments] = useState<StudentDocument[]>([]);
  const [transfers, setTransfers] = useState<RoomTransfer[]>([]);
  const [date, setDate] = useState(localDate());
  const [attendanceRange, setAttendanceRange] = useState(() => {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return { from: localDate(from), to: localDate() };
  });
  const [range, setRange] = useState({ from: localDate(), to: localDate() });
  const [meal, setMeal] = useState<(typeof mealTypes)[number]>('BREAKFAST');
  const [selectedResidentId, setSelectedResidentId] = useState('');
  const [attendanceValues, setAttendanceValues] = useState<Record<string, string>>({});
  const [mealValues, setMealValues] = useState<Record<string, string>>({});
  const [leaveForm, setLeaveForm] = useState({ startDate: '', endDate: '', reason: '' });
  const [gatePassForm, setGatePassForm] = useState({ exitAt: '', expectedReturnAt: '', reason: '' });
  const [planForm, setPlanForm] = useState({
    name: '',
    monthlyAmount: '',
    meals: ['BREAKFAST', 'LUNCH', 'DINNER'] as string[],
  });
  const [subscriptionForm, setSubscriptionForm] = useState({
    planId: '',
    startsOn: localDate(),
    endsOn: localDate(),
  });
  const [documentCategory, setDocumentCategory] = useState<(typeof documentCategories)[number]>('CNIC');
  const [replacingDocumentId, setReplacingDocumentId] = useState('');
  const [transferForm, setTransferForm] = useState({ bedId: '', reason: '' });
  const [exportDataset, setExportDataset] = useState<(typeof exportTypes)[number]>('residents');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!tabs.length) return;
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [tab, tabs]);

  useEffect(() => {
    if (!branchId || !tabs.length || !tabs.includes(tab)) return;
    let active = true;
    const base = `/branches/${branchId}`;
    const get = async <T,>(path: string) => {
      const response = await apiRequest<T>(path);
      if (!response.ok) throw new Error(response.message);
      return response.data;
    };
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const needsResidentList = mode === 'staff' && (
          (tab === 'attendance' && permissionSet.has('attendance:create'))
          || (tab === 'meal-attendance' && permissionSet.has('meal_attendance:create'))
          || (tab === 'subscriptions' && permissionSet.has('meal_subscriptions:create'))
          || tab === 'documents'
          || tab === 'transfers'
        );
        if (needsResidentList) {
          const rows = await get<Resident[]>(`${base}/residents`);
          if (!active) return;
          setResidents(rows);
          if (!selectedResidentId && rows[0]) setSelectedResidentId(rows[0].id);
        }
        if (tab === 'attendance') {
          const query = mode === 'student'
            ? new URLSearchParams(attendanceRange)
            : new URLSearchParams({ date });
          const path = mode === 'student' ? 'resident/attendance' : 'attendance';
          const result = await get<AttendanceResult>(`${base}/${path}?${query}`);
          if (!active) return;
          setAttendance(result);
          setAttendanceValues(Object.fromEntries(result.records.map((record) => [record.resident?.id ?? '', record.status])));
        } else if (tab === 'leave') {
          const path = mode === 'student' ? 'resident/leave-requests' : 'leave-requests';
          const rows = await get<LeaveRequest[]>(`${base}/${path}`);
          if (active) setLeaveRequests(rows);
        } else if (tab === 'gate-passes') {
          const path = mode === 'student' ? 'resident/gate-passes' : 'gate-passes';
          const rows = await get<GatePass[]>(`${base}/${path}`);
          if (active) setGatePasses(rows);
        } else if (tab === 'meal-attendance') {
          const query = mode === 'student'
            ? new URLSearchParams(attendanceRange)
            : new URLSearchParams({ date, meal });
          const path = mode === 'student' ? 'resident/meal-attendance' : 'meal-attendance';
          const result = await get<MealAttendanceResult>(`${base}/${path}?${query}`);
          if (!active) return;
          setMealAttendance(result);
          setMealValues(Object.fromEntries(result.records.map((record) => [record.resident?.id ?? '', record.status])));
        } else if (tab === 'subscriptions') {
          const path = mode === 'student' ? 'resident/meal-subscriptions' : 'meal-subscriptions';
          const [allPlans, allSubscriptions] = await Promise.all([
            get<MealPlan[]>(`${base}/meal-subscription-plans`),
            get<MealSubscription[]>(`${base}/${path}`),
          ]);
          if (!active) return;
          setPlans(allPlans);
          setSubscriptions(allSubscriptions);
          if (!subscriptionForm.planId && allPlans[0]) {
            setSubscriptionForm((current) => ({ ...current, planId: allPlans[0].id }));
          }
        } else if (tab === 'documents') {
          if (mode === 'student') {
            const rows = await get<StudentDocument[]>(`${base}/resident/documents`);
            if (active) setDocuments(rows);
          } else if (selectedResidentId) {
            const rows = await get<StudentDocument[]>(`${base}/residents/${selectedResidentId}/documents`);
            if (active) setDocuments(rows);
          }
        } else if (tab === 'transfers' && mode === 'staff') {
          const [availableBeds, history] = await Promise.all([
            get<Bed[]>(`${base}/available-transfer-beds`),
            get<RoomTransfer[]>(`${base}/room-transfers${selectedResidentId ? `?residentId=${selectedResidentId}` : ''}`),
          ]);
          if (!active) return;
          setBeds(availableBeds);
          setTransfers(history);
          if (!transferForm.bedId && availableBeds[0]) {
            setTransferForm((current) => ({ ...current, bedId: availableBeds[0].id }));
          }
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load hostel service data');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [attendanceRange, branchId, date, meal, mode, permissionSet, revision, selectedResidentId, subscriptionForm.planId, tab, tabs]);

  async function send<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, success?: string) {
    setBusy(true);
    setError('');
    setMessage('');
    const response = await apiRequest<T>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.message);
      return false;
    }
    setMessage(success ?? 'Saved.');
    setRevision((value) => value + 1);
    return true;
  }

  async function submitAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!residents.length) return;
    const result = await send(`/branches/${branchId}/attendance`, 'POST', {
      date,
      records: residents.map((resident) => ({
        residentId: resident.id,
        status: attendanceValues[resident.id] || 'PRESENT',
      })),
    }, 'Daily attendance saved.');
    if (result) setAttendanceValues({});
  }

  async function submitLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send(`/branches/${branchId}/resident/leave-requests`, 'POST', leaveForm, 'Leave request submitted.')) {
      setLeaveForm({ startDate: '', endDate: '', reason: '' });
    }
  }

  async function decideLeave(request: LeaveRequest, status: 'APPROVED' | 'REJECTED') {
    const note = status === 'REJECTED' ? window.prompt('Reason for rejection?')?.trim() : undefined;
    if (status === 'REJECTED' && !note) return;
    await send(`/branches/${branchId}/leave-requests/${request.id}/decision`, 'PATCH', {
      status,
      ...(note ? { note } : {}),
    }, `Leave request ${status.toLowerCase()}.`);
  }

  async function submitGatePass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send(`/branches/${branchId}/resident/gate-passes`, 'POST', {
      ...gatePassForm,
      exitAt: new Date(gatePassForm.exitAt).toISOString(),
      expectedReturnAt: new Date(gatePassForm.expectedReturnAt).toISOString(),
    }, 'Gate pass request submitted.')) {
      setGatePassForm({ exitAt: '', expectedReturnAt: '', reason: '' });
    }
  }

  async function decideGatePass(pass: GatePass, status: 'APPROVED' | 'REJECTED') {
    const rejectionReason = status === 'REJECTED' ? window.prompt('Reason for rejection?')?.trim() : undefined;
    if (status === 'REJECTED' && !rejectionReason) return;
    await send(`/branches/${branchId}/gate-passes/${pass.id}/decision`, 'PATCH', {
      status,
      ...(rejectionReason ? { rejectionReason } : {}),
    }, `Gate pass ${status.toLowerCase()}.`);
  }

  async function recordReturn(pass: GatePass) {
    await send(`/branches/${branchId}/gate-passes/${pass.id}/return`, 'POST', undefined, 'Student return recorded.');
  }

  async function submitMealAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!residents.length) return;
    await send(`/branches/${branchId}/meal-attendance`, 'POST', {
      date,
      meal,
      records: residents.map((resident) => ({
        residentId: resident.id,
        status: mealValues[resident.id] || 'ABSENT',
      })),
    }, `${meal.toLowerCase()} attendance saved.`);
  }

  async function submitMealPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(planForm.monthlyAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid monthly plan price.');
      return;
    }
    if (await send(`/branches/${branchId}/meal-subscription-plans`, 'POST', {
      name: planForm.name,
      monthlyAmountMinor: Math.round(amount * 100),
      mealTypes: planForm.meals,
    }, 'Meal plan created.')) {
      setPlanForm({ name: '', monthlyAmount: '', meals: ['BREAKFAST', 'LUNCH', 'DINNER'] });
    }
  }

  async function activateSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedResidentId) return;
    await send(`/branches/${branchId}/residents/${selectedResidentId}/meal-subscriptions`, 'POST', subscriptionForm, 'Subscription activated.');
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) {
      setError('Choose a PDF, JPEG, or PNG document.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    const formData = new FormData();
    formData.set('category', String(form.get('category') ?? documentCategory));
    formData.set('file', file);
    const residentDocumentPath = mode === 'student'
      ? `/branches/${branchId}/resident/documents`
      : `/branches/${branchId}/residents/${selectedResidentId}/documents`;
    const path = replacingDocumentId
      ? mode === 'student'
        ? `/branches/${branchId}/resident/documents/${replacingDocumentId}`
        : `/branches/${branchId}/residents/${selectedResidentId}/documents/${replacingDocumentId}`
      : residentDocumentPath;
    const result = await apiUpload<StudentDocument>(path, formData, replacingDocumentId ? 'PUT' : 'POST');
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage(replacingDocumentId ? 'Document replaced.' : 'Document uploaded securely.');
    setReplacingDocumentId('');
    formElement.reset();
    setRevision((value) => value + 1);
  }

  async function downloadDocument(document: StudentDocument) {
    const path = mode === 'student'
      ? `/branches/${branchId}/resident/documents/${document.id}`
      : `/branches/${branchId}/residents/${selectedResidentId}/documents/${document.id}`;
    const response = await apiDownload(path);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    const url = URL.createObjectURL(response.data);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = document.originalName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteDocument(document: StudentDocument) {
    if (!window.confirm(`Permanently delete ${document.originalName}?`)) return;
    await send(
      `/branches/${branchId}/residents/${selectedResidentId}/documents/${document.id}`,
      'DELETE',
      undefined,
      'Document deleted.',
    );
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedResidentId) return;
    await send(`/branches/${branchId}/residents/${selectedResidentId}/room-transfers`, 'POST', transferForm, 'Room transfer completed.');
  }

  async function exportRecords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    if (range.from && range.to) {
      query.set('from', range.from);
      query.set('to', range.to);
    }
    setBusy(true);
    setError('');
    setMessage('');
    const response = await apiDownload(`/branches/${branchId}/exports/${exportDataset}?${query}`);
    setBusy(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    const url = URL.createObjectURL(response.data);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${exportDataset}-${localDate()}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`${exportDataset[0].toUpperCase()}${exportDataset.slice(1)} workbook downloaded.`);
  }

  if (!tabs.length) return null;

  return (
    <section className="panel hostel-services-panel">
      <div className="panel-heading">
        <div><h2>Student services</h2><p>Branch-scoped records and requests.</p></div>
      </div>
      <nav className="workspace-tabs service-tabs" aria-label="Student services">
        {tabs.map((item) => (
          <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {serviceTitle(item)}
          </button>
        ))}
      </nav>
      {error && <div className="notice error" role="alert">{error}</div>}
      {message && <div className="notice success" role="status">{message}</div>}
      {loading && <p className="muted" aria-live="polite">Loading {serviceTitle(tab).toLowerCase()}…</p>}
      {mode === 'staff' && ['documents', 'transfers', 'subscriptions'].includes(tab) && (
        <label className="service-filter">Resident
          <select value={selectedResidentId} onChange={(event) => setSelectedResidentId(event.target.value)}>
            <option value="">Select a resident</option>
            {residents.map((resident) => <option key={resident.id} value={resident.id}>{resident.firstName} {resident.lastName}</option>)}
          </select>
        </label>
      )}

      {tab === 'attendance' && (
        <div className="service-content">
          <div className="service-filters">
            {mode === 'staff' ? (
              <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            ) : (
              <>
                <label>From<input type="date" value={attendanceRange.from} onChange={(event) => setAttendanceRange({ ...attendanceRange, from: event.target.value })} /></label>
                <label>To<input type="date" value={attendanceRange.to} onChange={(event) => setAttendanceRange({ ...attendanceRange, to: event.target.value })} /></label>
              </>
            )}
            {mode === 'staff' && attendance && (
              <div className="service-summary" aria-label="Attendance summary">
                {attendanceStatuses.map((status) => <span key={status}>{status.toLowerCase()}: <strong>{attendance.summary.counts[status] ?? 0}</strong></span>)}
              </div>
            )}
          </div>
          {mode === 'staff' && has('attendance', 'create') ? (
            <form className="stack-form" onSubmit={(event) => void submitAttendance(event)}>
              {!residents.length ? <p className="empty-state">No active residents in this branch.</p> : (
                <div className="service-record-list">
                  {residents.map((resident) => (
                    <label className="service-record" key={resident.id}>
                      <span>{resident.firstName} {resident.lastName}</span>
                      <select value={attendanceValues[resident.id] ?? 'PRESENT'} onChange={(event) => setAttendanceValues((current) => ({ ...current, [resident.id]: event.target.value }))}>
                        {attendanceStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {residents.length > 0 && <button className="button primary" disabled={busy}>Save daily attendance</button>}
            </form>
          ) : (
            <div className="record-list">
              {!attendance?.records.length ? <p className="empty-state">No attendance records for this date.</p> : attendance.records.map((record) => (
                <article className="record" key={record.id}>
                  <h3>{record.resident?.firstName} {record.resident?.lastName}</h3>
                  <p><span className={`status ${record.status.toLowerCase()}`}>{record.status}</span> · {dateLabel(record.attendanceDate)}</p>
                  {record.notes && <p>{record.notes}</p>}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'leave' && (
        <div className="service-content">
          {mode === 'student' && has('leave_requests', 'create') && (
            <form className="stack-form service-form" onSubmit={(event) => void submitLeave(event)}>
              <h3>Apply for leave</h3>
              <div className="two-fields">
                <label>From<input type="date" required value={leaveForm.startDate} onChange={(event) => setLeaveForm({ ...leaveForm, startDate: event.target.value })} /></label>
                <label>Through<input type="date" required value={leaveForm.endDate} onChange={(event) => setLeaveForm({ ...leaveForm, endDate: event.target.value })} /></label>
              </div>
              <label>Reason<textarea required maxLength={2000} value={leaveForm.reason} onChange={(event) => setLeaveForm({ ...leaveForm, reason: event.target.value })} /></label>
              <button className="button primary" disabled={busy}>Submit application</button>
            </form>
          )}
          <div className="record-list">
            {!leaveRequests.length ? <p className="empty-state">No leave applications yet.</p> : leaveRequests.map((request) => (
              <article className="record" key={request.id}>
                <div className="record-main">
                  <div><h3>{request.resident ? `${request.resident.firstName} ${request.resident.lastName}` : 'Leave request'}</h3><p>{dateLabel(request.startDate)} – {dateLabel(request.endDate)}</p></div>
                  <span className={`status ${request.status.toLowerCase()}`}>{request.status}</span>
                </div>
                <p>{request.reason}</p>
                {request.decisionNote && <p>Decision note: {request.decisionNote}</p>}
                {mode === 'staff' && request.status === 'PENDING' && has('leave_requests', 'approve') && (
                  <div className="button-row">
                    <button className="button primary small" type="button" disabled={busy} onClick={() => void decideLeave(request, 'APPROVED')}>Approve</button>
                    <button className="button secondary small" type="button" disabled={busy} onClick={() => void decideLeave(request, 'REJECTED')}>Reject</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'gate-passes' && (
        <div className="service-content">
          {mode === 'student' && has('gate_passes', 'create') && (
            <form className="stack-form service-form" onSubmit={(event) => void submitGatePass(event)}>
              <h3>Request a gate pass</h3>
              <div className="two-fields">
                <label>Exit date and time<input required type="datetime-local" value={gatePassForm.exitAt} onChange={(event) => setGatePassForm({ ...gatePassForm, exitAt: event.target.value })} /></label>
                <label>Expected return date and time<input required type="datetime-local" value={gatePassForm.expectedReturnAt} onChange={(event) => setGatePassForm({ ...gatePassForm, expectedReturnAt: event.target.value })} /></label>
              </div>
              <label>Reason<input required maxLength={1000} value={gatePassForm.reason} onChange={(event) => setGatePassForm({ ...gatePassForm, reason: event.target.value })} /></label>
              <button className="button primary" disabled={busy}>Submit request</button>
            </form>
          )}
          <div className="record-list">
            {!gatePasses.length ? <p className="empty-state">No gate pass requests yet.</p> : gatePasses.map((pass) => (
              <article className="record" key={pass.id}>
                <div className="record-main">
                  <div><h3>{pass.resident ? `${pass.resident.firstName} ${pass.resident.lastName}` : 'Gate pass'}</h3><p>Exit: {new Date(pass.exitAt).toLocaleString()} · Expected return: {new Date(pass.expectedReturnAt).toLocaleString()}</p></div>
                  <span className={`status ${pass.lateReturn ? 'deactivated' : pass.status.toLowerCase()}`}>{pass.lateReturn ? 'LATE RETURN' : pass.status}</span>
                </div>
                <p>{pass.reason}</p>
                {pass.actualReturnAt && <p>Returned: {new Date(pass.actualReturnAt).toLocaleString()}</p>}
                {pass.rejectionReason && <p>Rejection: {pass.rejectionReason}</p>}
                {mode === 'staff' && pass.status === 'PENDING' && has('gate_passes', 'approve') && (
                  <div className="button-row">
                    <button className="button primary small" type="button" disabled={busy} onClick={() => void decideGatePass(pass, 'APPROVED')}>Approve</button>
                    <button className="button secondary small" type="button" disabled={busy} onClick={() => void decideGatePass(pass, 'REJECTED')}>Reject</button>
                  </div>
                )}
                {mode === 'staff' && pass.status === 'APPROVED' && has('gate_passes', 'verify') && (
                  <button className="button secondary small" type="button" disabled={busy} onClick={() => void recordReturn(pass)}>Record return</button>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'meal-attendance' && (
        <div className="service-content">
          <div className="service-filters">
            {mode === 'staff' ? (
              <>
                <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
                <label>Meal<select value={meal} onChange={(event) => setMeal(event.target.value as (typeof mealTypes)[number])}>{mealTypes.map((mealType) => <option key={mealType}>{mealType}</option>)}</select></label>
              </>
            ) : (
              <>
                <label>From<input type="date" value={attendanceRange.from} onChange={(event) => setAttendanceRange({ ...attendanceRange, from: event.target.value })} /></label>
                <label>To<input type="date" value={attendanceRange.to} onChange={(event) => setAttendanceRange({ ...attendanceRange, to: event.target.value })} /></label>
              </>
            )}
            {mode === 'staff' && mealAttendance && (
              <div className="service-summary">{mealTypes.map((mealType) => <span key={mealType}>{mealType.toLowerCase()}: <strong>{mealAttendance.summary[mealType]?.present ?? 0} present / {mealAttendance.summary[mealType]?.absent ?? 0} absent</strong></span>)}</div>
            )}
          </div>
          {mode === 'staff' && has('meal_attendance', 'create') ? (
            <form className="stack-form" onSubmit={(event) => void submitMealAttendance(event)}>
              {!residents.length ? <p className="empty-state">No active residents in this branch.</p> : (
                <div className="service-record-list">
                  {residents.map((resident) => (
                    <label className="service-record" key={resident.id}>
                      <span>{resident.firstName} {resident.lastName}</span>
                      <select value={mealValues[resident.id] ?? 'ABSENT'} onChange={(event) => setMealValues((current) => ({ ...current, [resident.id]: event.target.value }))}>
                        <option value="PRESENT">Present</option><option value="ABSENT">Absent</option>
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {residents.length > 0 && <button className="button primary" disabled={busy}>Save {meal.toLowerCase()} attendance</button>}
            </form>
          ) : (
            <div className="record-list">
              {!mealAttendance?.records.length ? <p className="empty-state">No meal records for this date.</p> : mealAttendance.records.map((record) => (
                <article className="record" key={record.id}>
                  <h3>{record.meal} · {dateLabel(record.mealDate)}</h3>
                  <p><span className={`status ${record.status.toLowerCase()}`}>{record.status}</span></p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'subscriptions' && (
        <div className="service-content">
          {mode === 'staff' && has('meal_subscriptions', 'manage_settings') && (
            <form className="stack-form service-form" onSubmit={(event) => void submitMealPlan(event)}>
              <h3>Create monthly meal plan</h3>
              <div className="two-fields">
                <label>Plan name<input required maxLength={100} value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} /></label>
                <label>Monthly amount (PKR)<input required type="number" min={0} step="0.01" value={planForm.monthlyAmount} onChange={(event) => setPlanForm({ ...planForm, monthlyAmount: event.target.value })} /></label>
              </div>
              <fieldset className="service-checkboxes"><legend>Included meals</legend>
                {mealTypes.map((mealType) => <label key={mealType}><input type="checkbox" checked={planForm.meals.includes(mealType)} onChange={(event) => setPlanForm((current) => ({ ...current, meals: event.target.checked ? [...current.meals, mealType] : current.meals.filter((item) => item !== mealType) }))} />{mealType}</label>)}
              </fieldset>
              <button className="button primary" disabled={busy || !planForm.meals.length}>Create plan</button>
            </form>
          )}
          {mode === 'staff' && has('meal_subscriptions', 'create') && (
            <form className="stack-form service-form" onSubmit={(event) => void activateSubscription(event)}>
              <h3>Activate a student subscription</h3>
              <label>Plan<select required value={subscriptionForm.planId} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, planId: event.target.value })}><option value="">Select a plan</option>{plans.filter((plan) => plan.isActive).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {money(plan.monthlyAmountMinor)}</option>)}</select></label>
              <div className="two-fields">
                <label>Starts<input required type="date" value={subscriptionForm.startsOn} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, startsOn: event.target.value })} /></label>
                <label>Ends<input required type="date" value={subscriptionForm.endsOn} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, endsOn: event.target.value })} /></label>
              </div>
              <button className="button primary" disabled={busy || !selectedResidentId || !plans.some((plan) => plan.isActive)}>Activate subscription</button>
            </form>
          )}
          {mode === 'staff' && <div className="record-list">
            <h3>Available plans</h3>
            {!plans.length ? <p className="empty-state">No meal plans are configured.</p> : plans.map((plan) => (
              <article className="record record-main" key={plan.id}>
                <div><h3>{plan.name}</h3><p>{plan.mealTypes.join(', ')} · {money(plan.monthlyAmountMinor)} per month</p></div>
                <span className={`status ${plan.isActive ? 'active' : 'inactive'}`}>{plan.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
                {has('meal_subscriptions', 'manage_settings') && <button className="button secondary small" type="button" disabled={busy} onClick={() => void send(`/branches/${branchId}/meal-subscription-plans/${plan.id}`, 'PATCH', { isActive: !plan.isActive }, `Plan ${plan.isActive ? 'deactivated' : 'activated'}.`)}>{plan.isActive ? 'Deactivate' : 'Activate'}</button>}
              </article>
            ))}
          </div>}
          <div className="record-list">
            <h3>{mode === 'student' ? 'My subscriptions' : 'Student subscriptions'}</h3>
            {!subscriptions.length ? <p className="empty-state">No subscription records yet.</p> : subscriptions.map((subscription) => (
              <article className="record record-main" key={subscription.id}>
                <div><h3>{subscription.resident ? `${subscription.resident.firstName} ${subscription.resident.lastName} · ` : ''}{subscription.plan.name}</h3><p>{dateLabel(subscription.startsOn)} – {dateLabel(subscription.endsOn)} · {money(subscription.plan.monthlyAmountMinor)}</p></div>
                <span className={`status ${subscription.status.toLowerCase()}`}>{subscription.status}</span>
                {mode === 'staff' && subscription.status === 'ACTIVE' && has('meal_subscriptions', 'edit') && <button className="button secondary small" type="button" disabled={busy} onClick={() => void send(`/branches/${branchId}/meal-subscriptions/${subscription.id}/deactivate`, 'PATCH', undefined, 'Subscription deactivated.')}>Deactivate</button>}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div className="service-content">
          {(mode === 'student' ? has('student_documents', 'create') : has('student_documents', 'create')) && (
            <form className="stack-form service-form" onSubmit={(event) => void uploadDocument(event)}>
              <h3>{replacingDocumentId ? 'Replace document' : 'Upload a student document'}</h3>
              <label>Category<select name="category" value={documentCategory} onChange={(event) => setDocumentCategory(event.target.value as (typeof documentCategories)[number])}>{documentCategories.map((category) => <option key={category}>{category.replace('_', '/')}</option>)}</select></label>
              <label>PDF, JPEG or PNG · up to 10 MB<input name="file" required type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" /></label>
              <div className="button-row">
                <button className="button primary" disabled={busy || (mode === 'staff' && !selectedResidentId)}>{replacingDocumentId ? 'Replace document' : 'Upload securely'}</button>
                {replacingDocumentId && <button className="button secondary" type="button" onClick={() => setReplacingDocumentId('')}>Cancel replacement</button>}
              </div>
            </form>
          )}
          <div className="record-list">
            {!documents.length ? <p className="empty-state">No documents uploaded.</p> : documents.map((document) => (
              <article className="record record-main" key={document.id}>
                <div><h3>{document.category.replace('_', '/')}</h3><p>{document.originalName} · Uploaded {new Date(document.createdAt).toLocaleDateString()}</p></div>
                <div className="button-row">
                  <button className="button secondary small" type="button" onClick={() => void downloadDocument(document)}>Download</button>
                  {has('student_documents', 'edit') && <button className="button secondary small" type="button" onClick={() => { setReplacingDocumentId(document.id); setDocumentCategory(document.category as (typeof documentCategories)[number]); }}>Replace</button>}
                  {mode === 'staff' && has('student_documents', 'delete') && <button className="button danger small" type="button" onClick={() => void deleteDocument(document)}>Delete</button>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'transfers' && mode === 'staff' && (
        <div className="service-content">
          {has('allocations', 'assign') && (
            <form className="stack-form service-form" onSubmit={(event) => void submitTransfer(event)}>
              <h3>Transfer resident to another bed</h3>
              <label>Destination bed<select required value={transferForm.bedId} onChange={(event) => setTransferForm({ ...transferForm, bedId: event.target.value })}><option value="">Select an available bed</option>{beds.map((bed) => <option key={bed.id} value={bed.id}>{bed.room.floor.building.name} · {bed.room.code} · Bed {bed.code}</option>)}</select></label>
              <label>Reason<input required maxLength={1000} value={transferForm.reason} onChange={(event) => setTransferForm({ ...transferForm, reason: event.target.value })} /></label>
              <button className="button primary" disabled={busy || !selectedResidentId || !beds.length}>Transfer resident</button>
            </form>
          )}
          <div className="record-list">
            <h3>Room and bed history</h3>
            {!transfers.length ? <p className="empty-state">No room transfers recorded.</p> : transfers.map((transfer) => (
              <article className="record" key={transfer.id}>
                <h3>{transfer.resident.firstName} {transfer.resident.lastName}</h3>
                <p>{transfer.fromRoomCode} / {transfer.fromBedCode} → {transfer.toRoomCode} / {transfer.toBedCode}</p>
                <p>{transfer.reason} · {new Date(transfer.transferredAt).toLocaleString()}</p>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'exports' && mode === 'staff' && (
        <form className="stack-form service-form" onSubmit={(event) => void exportRecords(event)}>
          <h3>Download an approved records workbook</h3>
          <label>Record type<select value={exportDataset} onChange={(event) => setExportDataset(event.target.value as (typeof exportTypes)[number])}>{exportTypes.map((dataset) => <option key={dataset} value={dataset}>{dataset[0].toUpperCase()}{dataset.slice(1)}</option>)}</select></label>
          <div className="two-fields">
            <label>From<input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
            <label>To<input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
          </div>
          <p className="muted">Exports are limited to your current branch and dataset permissions. Finance exports omit proof files and sensitive identity data.</p>
          <button className="button primary" disabled={busy || Boolean(range.from) !== Boolean(range.to)}>Download Excel workbook</button>
        </form>
      )}
    </section>
  );
}
