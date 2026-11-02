'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiDownload, apiRequest, setAccessToken } from '@/lib/api/client';
import { getFinanceSubmissionKey, resetFormOnSuccess } from '@/lib/finance/submission';
import {
  dashboardCacheKey,
  readDashboardCache,
  writeDashboardCache,
  type OfflineDashboard,
} from '@/lib/offline/dashboard-cache';

type Branch = { id: string; name: string; code: string };
type Profile = { id: string; email: string | null; phone: string | null; roles: string[]; permissions: string[] };
type Resident = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  status: string;
  cnicMasked: string | null;
  accountLinked: boolean;
};
type Admission = {
  id: string;
  status: string;
  requestedCheckInAt: string | null;
  rejectionReason: string | null;
  resident: Resident;
  allocations: { status: string; bed: { code: string; room: { code: string } } }[];
};
type Bed = { id: string; code: string; room: { id: string; code: string } };
type Room = { id: string; code: string; floor: { id: string; name: string | null; level: number; building: { id: string; name: string } } };
type Floor = { id: string; level: number; name: string | null; rooms: { id: string; code: string }[] };
type Building = { id: string; name: string; floors: Floor[] };
type InvoiceLine = { id: string; description: string; quantity: number; unitAmountMinor: number; lineAmountMinor: number };
type FinancePayment = {
  id: string;
  amountMinor: number;
  method: string;
  status: string;
  reference: string | null;
  proofNotes: string | null;
  proofFileName: string | null;
  proofAvailable: boolean;
  rejectionReason: string | null;
};
type FinanceInvoice = {
  id: string;
  invoiceNumber: string;
  currency: string;
  status: string;
  dueAt: string | null;
  resident: { id: string; firstName: string; lastName: string };
  lines: InvoiceLine[];
  payments: FinancePayment[];
  invoiceTotalMinor: number;
  verifiedPaymentsMinor: number;
  refundedMinor: number;
  balanceDueMinor: number;
  creditMinor: number;
};
type FinanceReport = {
  from: string;
  to: string;
  currency: string;
  issuedInvoiceCount: number;
  issuedAmountMinor: number;
  verifiedPaymentsMinor: number;
  pendingPaymentsMinor: number;
  refundsMinor: number;
  outstandingInvoiceCount: number;
  outstandingAmountMinor: number;
  overdueInvoiceCount: number;
  overdueAmountMinor: number;
  outstandingInvoices: {
    invoiceNumber: string;
    residentName: string;
    dueAt: string | null;
    currency: string;
    balanceDueMinor: number;
    creditMinor: number;
  }[];
  outstandingInvoicesTruncated: boolean;
};
type MessMeal = 'BREAKFAST' | 'LUNCH' | 'DINNER';
type MessMenu = {
  id?: string | null;
  weekStart: string;
  entries: { dayOfWeek: number; meal: MessMeal; description: string }[];
};
type Complaint = {
  id: string;
  title: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  submittedByUserId: string;
  assignedToUserId: string | null;
  submittedBy: { id: string; email: string | null; phone: string | null };
  assignedTo: { id: string; email: string | null; phone: string | null } | null;
  createdAt: string;
};
type HostelNotice = {
  id: string;
  title: string;
  body: string;
  status: 'DRAFT' | 'PUBLISHED';
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
};
type OfflineStatus = {
  mode: 'READ_ONLY_CACHE';
  readOnly: boolean;
  cacheEnabled: boolean;
  syncRequired: boolean;
  allowedData: string[];
  blockedActions: string[];
  summary: string;
  lastCheckedAt: string;
};
type BackupVerification = {
  branchId: string;
  scriptPresent: boolean;
  backupDirectoryConfigured: boolean;
  retentionPolicyConfigured: boolean;
  retentionPolicy: string;
  configurationReady: boolean;
  restoreTestPerformed: boolean;
  warnings: string[];
  reviewedAt: string;
};
type VisitorVisit = {
  id: string;
  visitorName: string;
  visitorPhone: string | null;
  cnicMasked: string | null;
  purpose: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHECKED_IN' | 'CHECKED_OUT';
  hostResident: { id: string; firstName: string; lastName: string };
  approvedAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  createdAt: string;
};
type Section = 'admissions' | 'residents' | 'inventory' | 'finance' | 'mess' | 'complaints' | 'notices' | 'visitors' | 'offline';

const emptyResident = { firstName: '', lastName: '', phone: '', email: '', dateOfBirth: '', cnic: '' };
const emptyInvoiceLine = { description: '', quantity: '1', amount: '' };
const emptyVisitorVisit = { visitorName: '', cnic: '', visitorPhone: '', hostResidentId: '', purpose: '' };
const mealTypes: MessMeal[] = ['BREAKFAST', 'LUNCH', 'DINNER'];
const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dateInput = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};
function mondayOf(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  return monday;
}
const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

function formatMoney(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function getDateOfBirthError(value: string) {
  if (!value) return '';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime()) || dateInput(parsed) !== value) {
    return 'Enter a valid date of birth.';
  }
  return '';
}

export default function Phase2Workspace() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [section, setSection] = useState<Section>('admissions');
  const [menuWeek, setMenuWeek] = useState(dateInput(mondayOf(today)));
  const [menuEntries, setMenuEntries] = useState<Record<string, string>>({});
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [notices, setNotices] = useState<HostelNotice[]>([]);
  const [visitorVisits, setVisitorVisits] = useState<VisitorVisit[]>([]);
  const [offlineDashboard, setOfflineDashboard] = useState<OfflineDashboard | null>(null);
  const [offlineStatus, setOfflineStatus] = useState<OfflineStatus | null>(null);
  const [backupVerification, setBackupVerification] = useState<BackupVerification | null>(null);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [inventoryBeds, setInventoryBeds] = useState<{ id: string; code: string; room: { id: string; code: string }; status: string }[]>([]);
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState('');
  const [financeReport, setFinanceReport] = useState<FinanceReport | null>(null);
  const [reportPeriod, setReportPeriod] = useState({ from: dateInput(monthStart), to: dateInput(today) });
  const [reportLoading, setReportLoading] = useState(false);
  const [residentForm, setResidentForm] = useState(emptyResident);
  const [residentEditingId, setResidentEditingId] = useState('');
  const [residentSearch, setResidentSearch] = useState('');
  const [dateOfBirthError, setDateOfBirthError] = useState('');
  const [admissionForm, setAdmissionForm] = useState({ residentId: '', requestedCheckInAt: '', notes: '' });
  const [invoiceForm, setInvoiceForm] = useState({
    residentId: '',
    dueAt: '',
    notes: '',
    lines: [{ ...emptyInvoiceLine }],
  });
  const [complaintForm, setComplaintForm] = useState({ title: '', description: '', priority: 'NORMAL' });
  const [noticeForm, setNoticeForm] = useState({ title: '', body: '', startsAt: '', endsAt: '' });
  const [visitorVisitForm, setVisitorVisitForm] = useState(emptyVisitorVisit);
  const [visitorSearch, setVisitorSearch] = useState('');
  const [inventoryForm, setInventoryForm] = useState({
    buildingName: '', buildingId: '', floorLevel: '0', floorName: '',
    floorId: '', roomCode: '', bedCapacity: '1', roomId: '', bedCode: '',
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const financeSubmissionKeys = useRef(new Map<string, { signature: string; key: string }>());
  const financeSubmissionLocks = useRef(new Set<string>());

  const permissions = useMemo(() => new Set(profile?.permissions ?? []), [profile]);
  const can = useCallback((module: string, action: string) => (
    permissions.has(`${module}:${action}`)
  ), [permissions]);
  const availableSections = useMemo<Section[]>(() => [
    ...(permissions.has('admissions:view') || permissions.has('admissions:create') ? ['admissions' as const] : []),
    ...(permissions.has('residents:view') ? ['residents' as const] : []),
    ...(permissions.has('inventory:view') ? ['inventory' as const] : []),
    ...(permissions.has('invoices:view') || permissions.has('reports:view') ? ['finance' as const] : []),
    ...(permissions.has('mess:view') ? ['mess' as const] : []),
    ...(permissions.has('complaints:view') || permissions.has('complaints:create') ? ['complaints' as const] : []),
    ...(permissions.has('notices:view') ? ['notices' as const] : []),
    ...(permissions.has('visitors:view') || permissions.has('visitors:create') ? ['visitors' as const] : []),
    'offline' as const,
  ], [permissions]);
  const visibleSections = useMemo<Section[]>(
    () => (isOnline ? availableSections : ['offline']),
    [availableSections, isOnline],
  );

  useEffect(() => {
    if (visibleSections.length && !visibleSections.includes(section)) {
      setSection(isOnline ? visibleSections[0] : 'offline');
    }
  }, [isOnline, visibleSections, section]);

  useEffect(() => {
    const updateConnectivity = () => setIsOnline(navigator.onLine);
    updateConnectivity();
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    return () => {
      window.removeEventListener('online', updateConnectivity);
      window.removeEventListener('offline', updateConnectivity);
    };
  }, []);

  useEffect(() => {
    if (isOnline) return;
    setError('');
    setMessage('');
    setResidents([]);
    setAdmissions([]);
    setBeds([]);
    setBuildings([]);
    setRooms([]);
    setInventoryBeds([]);
    setInvoices([]);
    setFinanceReport(null);
    setComplaints([]);
    setNotices([]);
    setVisitorVisits([]);
    setMenuEntries({});
    setResidentForm({ ...emptyResident });
    setAdmissionForm({ residentId: '', requestedCheckInAt: '', notes: '' });
    setInvoiceForm({
      residentId: '',
      dueAt: '',
      notes: '',
      lines: [{ ...emptyInvoiceLine }],
    });
    setComplaintForm({ title: '', description: '', priority: 'NORMAL' });
    setNoticeForm({ title: '', body: '', startsAt: '', endsAt: '' });
    setVisitorVisitForm({ ...emptyVisitorVisit });
    setVisitorSearch('');
    setInventoryForm({
      buildingName: '', buildingId: '', floorLevel: '0', floorName: '',
      floorId: '', roomCode: '', bedCapacity: '1', roomId: '', bedCode: '',
    });
  }, [isOnline]);

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
      setProfile(current.data);
      const branchList = await apiRequest<Branch[]>('/branches');
      if (!active) return;
      if (!branchList.ok) {
        setError(branchList.message);
        setLoading(false);
        return;
      }
      setBranches(branchList.data);
      const remembered = typeof window === 'undefined' ? '' : sessionStorage.getItem('hms-branch') ?? '';
      setBranchId(branchList.data.some((branch) => branch.id === remembered)
        ? remembered
        : branchList.data[0]?.id ?? '');
      if (!branchList.data.length) setLoading(false);
    }
    void initialize();
    return () => { active = false; };
  }, [router]);

  const loadData = useCallback(async (selectedBranchId: string) => {
    if (!selectedBranchId || !profile || !isOnline) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const tasks: Promise<void>[] = [];
    const load = async <T,>(path: string, setter: (value: T) => void) => {
      const response = await apiRequest<T>(path);
      if (response.ok) setter(response.data);
      else throw new Error(response.message);
    };
    if (can('residents', 'view')) {
      tasks.push(load<Resident[]>(`/branches/${selectedBranchId}/residents`, setResidents));
    }
    if (can('admissions', 'view')) {
      tasks.push(load<Admission[]>(`/branches/${selectedBranchId}/admissions`, setAdmissions));
    }
    if (can('allocations', 'view')) {
      tasks.push(load<Bed[]>(`/branches/${selectedBranchId}/admissions/available-beds`, setBeds));
    }
    if (can('inventory', 'view')) {
      tasks.push(
        load<Building[]>(`/branches/${selectedBranchId}/inventory/buildings`, setBuildings),
        load<Room[]>(`/branches/${selectedBranchId}/inventory/rooms`, setRooms),
        load<{ id: string; code: string; room: { id: string; code: string }; status: string }[]>(
          `/branches/${selectedBranchId}/inventory/beds`,
          setInventoryBeds,
        ),
      );
    }
    if (can('invoices', 'view')) {
      tasks.push(load<FinanceInvoice[]>(`/branches/${selectedBranchId}/invoices`, setInvoices));
    }
    if (can('mess', 'view')) {
      const query = new URLSearchParams({ weekStart: menuWeek });
      tasks.push((async () => {
        const response = await apiRequest<MessMenu>(
          `/branches/${selectedBranchId}/mess-menus?${query.toString()}`,
        );
        if (!response.ok) throw new Error(response.message);
        setMenuEntries(Object.fromEntries(
          response.data.entries.map((entry) => [
            `${entry.dayOfWeek}:${entry.meal}`,
            entry.description,
          ]),
        ));
      })());
    }
    if (can('complaints', 'view')) {
      const complaintPath = can('complaints', 'edit')
        ? `/branches/${selectedBranchId}/complaints/queue`
        : `/branches/${selectedBranchId}/complaints`;
      tasks.push(load<Complaint[]>(complaintPath, setComplaints));
    }
    if (can('notices', 'view')) {
      const noticePath = can('notices', 'edit')
        ? `/branches/${selectedBranchId}/notices/manage`
        : `/branches/${selectedBranchId}/notices`;
      tasks.push(load<HostelNotice[]>(noticePath, setNotices));
    }
    if (can('visitors', 'view')) {
      tasks.push(load<VisitorVisit[]>(`/branches/${selectedBranchId}/visitors`, setVisitorVisits));
    }
    const results = await Promise.allSettled(tasks);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected && navigator.onLine) {
      setError(rejected.reason instanceof Error ? rejected.reason.message : 'Could not load branch data');
    }
    setLoading(false);
  }, [profile, can, isOnline, menuWeek]);

  const loadFinanceReport = useCallback(async () => {
    if (!branchId || !isOnline || !can('reports', 'view')) return;
    setReportLoading(true);
    setError('');
    const query = new URLSearchParams(reportPeriod);
    const response = await apiRequest<FinanceReport>(`/branches/${branchId}/finance-report?${query.toString()}`);
    setReportLoading(false);
    if (!response.ok) {
      if (response.status !== 0 || navigator.onLine) setError(response.message);
      return;
    }
    setFinanceReport(response.data);
  }, [branchId, can, isOnline, reportPeriod]);

  const loadOfflineDashboard = useCallback(async () => {
    if (!branchId || !profile?.id) return;
    const key = dashboardCacheKey(profile.id, branchId);
    let storage: Storage;
    try {
      storage = window.sessionStorage;
    } catch {
      setError('Browser session storage is unavailable; offline dashboard caching is disabled.');
      return;
    }
    const cached = readDashboardCache(storage, key);
    if (cached.value) setOfflineDashboard(cached.value);
    if (cached.error) setError(cached.error);
    if (!isOnline) return;

    const response = await apiRequest<OfflineDashboard>(
      `/branches/${branchId}/offline-dashboard`,
    );
    if (!response.ok) {
      if (response.status !== 0 || !cached.value) setError(response.message);
      return;
    }
    setOfflineDashboard(response.data);
    const cacheError = writeDashboardCache(storage, key, response.data);
    if (cacheError) setError(cacheError);
  }, [branchId, profile?.id, isOnline]);

  const loadOfflineStatus = useCallback(async () => {
    if (!branchId || !isOnline) return;
    const response = await apiRequest<OfflineStatus>(`/branches/${branchId}/offline-status`);
    if (!response.ok) {
      if (response.status !== 0 || navigator.onLine) setError(response.message);
      return;
    }
    setOfflineStatus(response.data);
  }, [branchId, isOnline]);

  const loadBackupVerification = useCallback(async () => {
    if (!branchId || !isOnline) return;
    const response = await apiRequest<BackupVerification>(`/branches/${branchId}/backup-verification`);
    if (!response.ok) {
      if (response.status !== 0 || navigator.onLine) setError(response.message);
      return;
    }
    setBackupVerification(response.data);
  }, [branchId, isOnline]);

  useEffect(() => {
    void loadFinanceReport();
  }, [loadFinanceReport]);

  useEffect(() => {
    if (branchId) {
      sessionStorage.setItem('hms-branch', branchId);
      void loadData(branchId);
      void loadOfflineDashboard();
      void loadOfflineStatus();
      void loadBackupVerification();
    }
  }, [branchId, loadData, loadOfflineDashboard, loadOfflineStatus, loadBackupVerification]);

  async function refreshOfflineStatus() {
    if (!branchId || !isOnline || !navigator.onLine) {
      setError('Sync check is unavailable offline. No changes are queued.');
      return;
    }
    const response = await apiRequest<OfflineStatus>(`/branches/${branchId}/offline/sync-check`, { method: 'POST' });
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setOfflineStatus(response.data);
    await loadOfflineDashboard();
    setMessage('Offline cache status refreshed.');
  }

  async function verifyBackupRestore() {
    if (!branchId || !isOnline || !navigator.onLine) {
      setError('Backup configuration cannot be checked offline.');
      return;
    }
    const response = await apiRequest<BackupVerification>(`/branches/${branchId}/backup-verification`, { method: 'POST' });
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setBackupVerification(response.data);
    setMessage('Backup configuration preflight completed. A restore test was not performed.');
  }

  async function mutate<T>(path: string, options: RequestInit, successMessage: string) {
    if (!isOnline || !navigator.onLine) {
      setError('This action is blocked offline. No changes were saved or queued.');
      setMessage('');
      return false;
    }
    setBusy(true);
    setError('');
    setMessage('');
    const response = await apiRequest<T>(path, options);
    setBusy(false);
    if (!response.ok) {
      setError(response.message);
      return false;
    }
    setMessage(successMessage);
    await Promise.all([loadData(branchId), loadFinanceReport()]);
    return true;
  }

  async function createResident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const birthDateError = getDateOfBirthError(residentForm.dateOfBirth);
    setDateOfBirthError(birthDateError);
    if (birthDateError) return;
    const payload = Object.fromEntries(
      Object.entries(residentForm).filter(([, value]) => value !== ''),
    );
    if (residentEditingId) delete payload.cnic;
    const editing = Boolean(residentEditingId);
    const path = `/branches/${branchId}/residents${editing ? `/${residentEditingId}` : ''}`;
    if (await mutate<Resident>(path, {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    }, editing ? 'Resident details updated.' : 'Resident record created. CNIC is stored encrypted and shown only masked.')) {
      setResidentForm(emptyResident);
      setResidentEditingId('');
      setDateOfBirthError('');
    }
  }

  async function searchResidents(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = residentSearch.trim();
    const searchParams = new URLSearchParams();
    if (query) searchParams.set('search', query);
    const suffix = searchParams.size ? `?${searchParams.toString()}` : '';
    const response = await apiRequest<Resident[]>(`/branches/${branchId}/residents${suffix}`);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResidents(response.data);
    setError('');
  }

  function editResident(resident: Resident) {
    setResidentEditingId(resident.id);
    setResidentForm({
      firstName: resident.firstName,
      lastName: resident.lastName,
      phone: resident.phone ?? '',
      email: resident.email ?? '',
      dateOfBirth: resident.dateOfBirth ? dateInput(new Date(resident.dateOfBirth)) : '',
      cnic: '',
    });
    setDateOfBirthError('');
  }

  async function deactivateResident(resident: Resident) {
    if (!window.confirm(`Deactivate ${resident.firstName} ${resident.lastName}?`)) return;
    await mutate(`/branches/${branchId}/residents/${resident.id}`, { method: 'DELETE' }, 'Resident deactivated.');
  }

  async function createAdmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      residentId: admissionForm.residentId,
      ...(admissionForm.requestedCheckInAt
        ? { requestedCheckInAt: new Date(admissionForm.requestedCheckInAt).toISOString() }
        : {}),
      ...(admissionForm.notes ? { notes: admissionForm.notes } : {}),
    };
    if (await mutate<Admission>(`/branches/${branchId}/admissions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, 'Admission submitted for approval. Bed assignment is disabled until approval.')) {
      setAdmissionForm({ residentId: '', requestedCheckInAt: '', notes: '' });
    }
  }

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      residentId: invoiceForm.residentId,
      ...(invoiceForm.dueAt ? { dueAt: new Date(`${invoiceForm.dueAt}T23:59:59`).toISOString() } : {}),
      ...(invoiceForm.notes ? { notes: invoiceForm.notes } : {}),
      lines: invoiceForm.lines.map((line) => ({
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unitAmountMinor: Math.round(Number(line.amount) * 100),
      })),
    };
    if (await mutate<FinanceInvoice>(`/branches/${branchId}/invoices`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, 'Invoice issued. Amounts are stored in minor currency units.')) {
      setInvoiceForm({ residentId: '', dueAt: '', notes: '', lines: [{ ...emptyInvoiceLine }] });
    }
  }

  async function recordInvoicePayment(event: FormEvent<HTMLFormElement>, invoiceId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const lockKey = `payment:${invoiceId}`;
    if (financeSubmissionLocks.current.has(lockKey)) return;
    financeSubmissionLocks.current.add(lockKey);
    const form = new FormData(formElement);
    const amountMinor = Math.round(Number(form.get('amount')) * 100);
    const payload = {
        amountMinor,
        method: form.get('method'),
        ...(form.get('reference') ? { reference: form.get('reference') } : {}),
        ...(form.get('proofNotes') ? { proofNotes: form.get('proofNotes') } : {}),
    };
    const key = getFinanceSubmissionKey(financeSubmissionKeys.current, lockKey, payload);
    try {
      if (await resetFormOnSuccess(formElement, () => mutate<FinanceInvoice>(
        `/branches/${branchId}/invoices/${invoiceId}/payments`,
        {
          method: 'POST',
          body: JSON.stringify({ ...payload, submissionKey: key }),
        },
        'Payment recorded and queued for verification.',
      ))) {
        financeSubmissionKeys.current.delete(lockKey);
      }
    } finally {
      financeSubmissionLocks.current.delete(lockKey);
    }
  }

  async function reviewFinancePayment(payment: FinancePayment, status: 'VERIFIED' | 'REJECTED') {
    const rejectionReason = status === 'REJECTED'
      ? window.prompt('Reason for rejecting this payment?')?.trim()
      : undefined;
    if (status === 'REJECTED' && !rejectionReason) return;
    await mutate<FinanceInvoice>(`/branches/${branchId}/payments/${payment.id}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...(rejectionReason ? { rejectionReason } : {}) }),
    }, status === 'VERIFIED' ? 'Payment verified.' : 'Payment rejected.');
  }

  async function recordInvoiceRefund(event: FormEvent<HTMLFormElement>, invoiceId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const lockKey = `refund:${invoiceId}`;
    if (financeSubmissionLocks.current.has(lockKey)) return;
    financeSubmissionLocks.current.add(lockKey);
    const form = new FormData(formElement);
    const amountMinor = Math.round(Number(form.get('amount')) * 100);
    const payload = {
        amountMinor,
        method: form.get('method'),
        ...(form.get('reference') ? { reference: form.get('reference') } : {}),
        ...(form.get('notes') ? { notes: form.get('notes') } : {}),
    };
    const key = getFinanceSubmissionKey(financeSubmissionKeys.current, lockKey, payload);
    try {
      if (await resetFormOnSuccess(formElement, () => mutate<FinanceInvoice>(
        `/branches/${branchId}/invoices/${invoiceId}/refunds`,
        {
          method: 'POST',
          body: JSON.stringify({ ...payload, submissionKey: key }),
        },
        'Manual refund recorded.',
      ))) {
        financeSubmissionKeys.current.delete(lockKey);
      }
    } finally {
      financeSubmissionLocks.current.delete(lockKey);
    }
  }

  async function voidInvoice(invoice: FinanceInvoice) {
    if (!window.confirm(`Void invoice ${invoice.invoiceNumber}? This action cannot be undone.`)) return;
    await mutate<FinanceInvoice>(
      `/branches/${branchId}/invoices/${invoice.id}/void`,
      { method: 'PATCH' },
      `Invoice ${invoice.invoiceNumber} voided.`,
    );
  }

  async function downloadInvoicePdf(invoice: FinanceInvoice) {
    setDownloadingInvoiceId(invoice.id);
    setError('');
    const response = await apiDownload(`/branches/${branchId}/invoices/${invoice.id}/pdf`);
    setDownloadingInvoiceId('');
    if (!response.ok) {
      setError(response.message);
      return;
    }
    const objectUrl = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${invoice.invoiceNumber}.pdf`;
    link.click();
    URL.revokeObjectURL(objectUrl);
    setMessage(`Downloaded invoice ${invoice.invoiceNumber}.`);
  }

  async function downloadPaymentProof(payment: FinancePayment) {
    setError('');
    const response = await apiDownload(`/branches/${branchId}/payments/${payment.id}/proof`);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    const objectUrl = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = payment.proofFileName ?? 'payment-proof';
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  function exportFinanceReport() {
    if (!financeReport) return;
    const csvCell = (value: string | number) => {
      const raw = String(value);
      const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = [
      ['Finance report', financeReport.from, financeReport.to],
      ['Issued invoices', financeReport.issuedInvoiceCount, financeReport.issuedAmountMinor, financeReport.currency],
      ['Verified payments', financeReport.verifiedPaymentsMinor, financeReport.currency],
      ['Pending payments', financeReport.pendingPaymentsMinor, financeReport.currency],
      ['Refunds', financeReport.refundsMinor, financeReport.currency],
      ['Outstanding invoices', financeReport.outstandingInvoiceCount, financeReport.outstandingAmountMinor, financeReport.currency],
      ['Overdue invoices', financeReport.overdueInvoiceCount, financeReport.overdueAmountMinor, financeReport.currency],
      [],
      ['Invoice', 'Resident', 'Due date', 'Balance due minor units'],
      ...financeReport.outstandingInvoices.map((item) => [
        item.invoiceNumber, item.residentName, item.dueAt ? item.dueAt.slice(0, 10) : '', item.balanceDueMinor,
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map((cell) => csvCell(cell ?? '')).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `finance-report-${financeReport.from}-${financeReport.to}.csv`;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  async function reviewAdmission(admission: Admission, decision: 'APPROVED' | 'REJECTED') {
    const rejectionReason = decision === 'REJECTED'
      ? window.prompt('Reason for rejecting this admission?')?.trim()
      : undefined;
    if (decision === 'REJECTED' && !rejectionReason) return;
    await mutate<Admission>(`/branches/${branchId}/admissions/${admission.id}/decision`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, ...(rejectionReason ? { rejectionReason } : {}) }),
    }, decision === 'APPROVED' ? 'Admission approved.' : 'Admission rejected.');
  }

  async function allocateBed(admissionId: string, bedId: string) {
    if (!bedId) return;
    await mutate(`/branches/${branchId}/admissions/${admissionId}/allocation`, {
      method: 'POST',
      body: JSON.stringify({ bedId }),
    }, 'Bed reserved for the approved admission.');
  }

  async function createInventory(event: FormEvent<HTMLFormElement>, kind: 'building' | 'floor' | 'room' | 'bed') {
    event.preventDefault();
    const urls = {
      building: `/branches/${branchId}/inventory/buildings`,
      floor: `/branches/${branchId}/inventory/floors`,
      room: `/branches/${branchId}/inventory/rooms`,
      bed: `/branches/${branchId}/inventory/beds`,
    };
    const payloads = {
      building: { name: inventoryForm.buildingName },
      floor: {
        buildingId: inventoryForm.buildingId,
        level: Number(inventoryForm.floorLevel),
        ...(inventoryForm.floorName ? { name: inventoryForm.floorName } : {}),
      },
      room: {
        floorId: inventoryForm.floorId,
        code: inventoryForm.roomCode,
        bedCapacity: Number(inventoryForm.bedCapacity),
      },
      bed: { roomId: inventoryForm.roomId, code: inventoryForm.bedCode },
    };
    const created = await mutate(urls[kind], {
      method: 'POST',
      body: JSON.stringify(payloads[kind]),
    }, `${kind[0].toUpperCase()}${kind.slice(1)} created.`);
    if (created) {
      setInventoryForm((form) => ({
        ...form,
        ...(kind === 'building' ? { buildingName: '' } : {}),
        ...(kind === 'floor' ? { floorName: '' } : {}),
        ...(kind === 'room' ? { roomCode: '' } : {}),
        ...(kind === 'bed' ? { bedCode: '' } : {}),
      }));
    }
  }

  async function saveMessMenu(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entries = Object.entries(menuEntries)
      .filter(([, description]) => description.trim())
      .map(([key, description]) => {
        const [dayOfWeek, meal] = key.split(':');
        return { dayOfWeek: Number(dayOfWeek), meal, description: description.trim() };
      });
    if (!entries.length) {
      setError('Add at least one meal to the weekly menu.');
      return;
    }
    await mutate<MessMenu>(`/branches/${branchId}/mess-menus`, {
      method: 'PUT',
      body: JSON.stringify({ weekStart: menuWeek, entries }),
    }, 'Weekly mess menu saved.');
  }

  async function createComplaint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate<Complaint>(`/branches/${branchId}/complaints`, {
      method: 'POST',
      body: JSON.stringify(complaintForm),
    }, 'Complaint submitted. You can follow its status here.')) {
      setComplaintForm({ title: '', description: '', priority: 'NORMAL' });
    }
  }

  async function updateComplaint(complaint: Complaint, changes: { status?: Complaint['status']; priority?: Complaint['priority'] }) {
    await mutate<Complaint>(`/branches/${branchId}/complaints/${complaint.id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }, 'Complaint updated.');
  }

  async function assignComplaint(complaint: Complaint) {
    await mutate<Complaint>(`/branches/${branchId}/complaints/${complaint.id}/assign-to-me`, {
      method: 'POST',
    }, 'Complaint assigned to you.');
  }

  async function createNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      title: noticeForm.title,
      body: noticeForm.body,
      ...(noticeForm.startsAt ? { startsAt: noticeForm.startsAt } : {}),
      ...(noticeForm.endsAt ? { endsAt: noticeForm.endsAt } : {}),
    };
    if (await mutate<HostelNotice>(`/branches/${branchId}/notices`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, 'Notice saved as a draft.')) {
      setNoticeForm({ title: '', body: '', startsAt: '', endsAt: '' });
    }
  }

  async function setNoticeStatus(notice: HostelNotice, status: HostelNotice['status']) {
    await mutate<HostelNotice>(`/branches/${branchId}/notices/${notice.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }, status === 'PUBLISHED' ? 'Notice published.' : 'Notice unpublished.');
  }

  async function editNotice(event: FormEvent<HTMLFormElement>, notice: HostelNotice) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate<HostelNotice>(`/branches/${branchId}/notices/${notice.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: form.get('title'),
        body: form.get('body'),
        startsAt: form.get('startsAt') || null,
        endsAt: form.get('endsAt') || null,
      }),
    }, 'Notice updated.');
  }

  async function createVisitorVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate<VisitorVisit>(`/branches/${branchId}/visitors`, {
      method: 'POST',
      body: JSON.stringify({
        ...visitorVisitForm,
        ...(visitorVisitForm.visitorPhone ? {} : { visitorPhone: undefined }),
      }),
    }, 'Visitor registered and awaiting staff approval.')) {
      setVisitorVisitForm(emptyVisitorVisit);
    }
  }

  async function searchVisitorHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = visitorSearch.trim();
    const path = `/branches/${branchId}/visitors${query ? `?q=${encodeURIComponent(query)}` : ''}`;
    const response = await apiRequest<VisitorVisit[]>(path);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setError('');
    setVisitorVisits(response.data);
  }

  async function clearVisitorSearch() {
    setVisitorSearch('');
    const response = await apiRequest<VisitorVisit[]>(`/branches/${branchId}/visitors`);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setError('');
    setVisitorVisits(response.data);
  }

  async function transitionVisitorVisit(visit: VisitorVisit, action: 'approve' | 'reject' | 'check-in' | 'check-out') {
    const messages = {
      approve: 'Visitor visit approved.',
      reject: 'Visitor visit rejected.',
      'check-in': 'Visitor checked in.',
      'check-out': 'Visitor checked out.',
    };
    await mutate<VisitorVisit>(`/branches/${branchId}/visitors/${visit.id}/${action}`, {
      method: 'POST',
    }, messages[action]);
  }

  async function signOut() {
    const response = await apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    if (!response.ok) {
      setError(`Could not sign out: ${response.message}`);
      return;
    }
    setAccessToken(null);
    router.replace('/login');
  }

  if (loading && !profile) return <main className="workspace-loading">Loading your workspace…</main>;
  if (!profile) return <main className="workspace-loading"><p role="alert">{error || 'Please sign in to continue.'}</p></main>;

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <a className="brand-lockup" href="/">HMS <span>Operations</span></a>
        <div className="workspace-user">
          {isOnline && <span>{profile.email || profile.phone || profile.roles.join(', ')}</span>}
          <button className="button secondary" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>
      <div className="workspace-content">
        {!isOnline && (
          <div className="notice error" role="status">
            Offline — read-only cached dashboard counts are available in the Offline section. Changes are not saved or queued.
          </div>
        )}
        <div className="workspace-title">
        <div><span className="eyebrow">HOSTEL WORKSPACE</span><h1>Hostel operations</h1></div>
          {branches.length > 0 && (
            <label className="branch-picker">Branch
              <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}
              </select>
            </label>
          )}
        </div>

        {!branches.length ? (
          <section className="panel"><h2>No branch access</h2><p>Your account does not have an active branch assigned. Ask an administrator to grant branch access.</p></section>
        ) : (
          <>
            <nav className="workspace-tabs" aria-label="Hostel management">
              {visibleSections.map((tab) => (
                <button key={tab} type="button" className={section === tab ? 'active' : ''} onClick={() => setSection(tab)}>
                  {tab[0].toUpperCase()}{tab.slice(1)}
                </button>
              ))}
            </nav>
            {error && <div className="notice error" role="alert">{error}</div>}
            {message && <div className="notice success" role="status">{message}</div>}
            {loading && <p className="muted">Refreshing branch data…</p>}

            {section === 'admissions' && (
              <div className="content-grid">
                {can('admissions', 'create') && (
                  <section className="panel">
                    <h2>Start an admission</h2>
                    <p>Create the resident first, then submit their admission for review.</p>
                    <form className="stack-form" onSubmit={createAdmission}>
                      <label>Resident
                        <select required value={admissionForm.residentId} onChange={(event) => setAdmissionForm({ ...admissionForm, residentId: event.target.value })}>
                          <option value="">Select a resident</option>
                          {residents.filter((resident) => resident.status === 'ACTIVE').map((resident) => (
                            <option key={resident.id} value={resident.id}>{resident.firstName} {resident.lastName}{resident.cnicMasked ? ` · CNIC ${resident.cnicMasked}` : ''}</option>
                          ))}
                        </select>
                      </label>
                      <label>Requested check-in
                        <input type="datetime-local" value={admissionForm.requestedCheckInAt} onChange={(event) => setAdmissionForm({ ...admissionForm, requestedCheckInAt: event.target.value })} />
                      </label>
                      <label>Notes
                        <textarea maxLength={2000} rows={3} value={admissionForm.notes} onChange={(event) => setAdmissionForm({ ...admissionForm, notes: event.target.value })} />
                      </label>
                      <button className="button primary" disabled={busy || !residents.length}>Submit for approval</button>
                    </form>
                  </section>
                )}
                <section className="panel grow">
                  <div className="panel-heading"><div><h2>Admissions</h2><p>Approval is required before bed assignment.</p></div><span className="count-pill">{admissions.length}</span></div>
                  {!admissions.length ? <p className="empty-state">No admissions yet.</p> : (
                    <div className="record-list">
                      {admissions.map((admission) => {
                        const allocation = admission.allocations[0];
                        return (
                          <article className="record" key={admission.id}>
                            <div className="record-main">
                              <div><h3>{admission.resident.firstName} {admission.resident.lastName}</h3><p>{admission.resident.phone || admission.resident.email || 'No contact details'}{admission.resident.cnicMasked ? ` · CNIC ${admission.resident.cnicMasked}` : ''}</p></div>
                              <span className={`status ${admission.status.toLowerCase()}`}>{admission.status.replace('_', ' ')}</span>
                            </div>
                            {admission.rejectionReason && <p className="form-error">Reason: {admission.rejectionReason}</p>}
                            {admission.status === 'PENDING' && can('admissions', 'approve') && (
                              <div className="record-actions">
                                <button className="button primary small" type="button" disabled={busy} onClick={() => void reviewAdmission(admission, 'APPROVED')}>Approve</button>
                                <button className="button danger small" type="button" disabled={busy} onClick={() => void reviewAdmission(admission, 'REJECTED')}>Reject</button>
                              </div>
                            )}
                            {admission.status === 'APPROVED' && !allocation && can('allocations', 'assign') && can('allocations', 'view') && (
                              <div className="record-actions">
                                <select aria-label={`Select bed for ${admission.resident.firstName}`} id={`bed-${admission.id}`} defaultValue="">
                                  <option value="">Choose available bed</option>
                                  {beds.map((bed) => <option key={bed.id} value={bed.id}>{bed.room.code} / {bed.code}</option>)}
                                </select>
                                <button className="button primary small" type="button" disabled={busy || !beds.length} onClick={() => {
                                  const select = document.getElementById(`bed-${admission.id}`) as HTMLSelectElement | null;
                                  if (select) void allocateBed(admission.id, select.value);
                                }}>Assign bed</button>
                              </div>
                            )}
                            {allocation && <p className="allocation-info">Bed {allocation.bed.room.code} / {allocation.bed.code} · {allocation.status.replace('_', ' ').toLowerCase()}</p>}
                            {allocation?.status === 'RESERVED' && can('allocations', 'assign') && (
                              <button className="button primary small" type="button" disabled={busy} onClick={() => void mutate(`/branches/${branchId}/admissions/${admission.id}/check-in`, { method: 'POST' }, 'Resident checked in.')}>Check in</button>
                            )}
                            {admission.status === 'CHECKED_IN' && can('allocations', 'assign') && (
                              <button className="button secondary small" type="button" disabled={busy} onClick={() => void mutate(`/branches/${branchId}/admissions/${admission.id}/check-out`, { method: 'POST' }, 'Resident checked out and bed released.')}>Check out</button>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}

            {section === 'residents' && (
              <div className="content-grid">
                {(can('residents', 'create') || Boolean(residentEditingId)) && (
                  <section className="panel">
                    <h2>{residentEditingId ? 'Edit resident' : 'Register a resident'}</h2>
                    <p>CNIC is encrypted at rest and returned only in masked form.</p>
                    <form className="stack-form" onSubmit={createResident}>
                      <div className="two-fields">
                        <label>First name<input required maxLength={100} value={residentForm.firstName} onChange={(event) => setResidentForm({ ...residentForm, firstName: event.target.value })} /></label>
                        <label>Last name<input required maxLength={100} value={residentForm.lastName} onChange={(event) => setResidentForm({ ...residentForm, lastName: event.target.value })} /></label>
                      </div>
                      <label>Phone<input maxLength={30} value={residentForm.phone} onChange={(event) => setResidentForm({ ...residentForm, phone: event.target.value })} /></label>
                      <label>Email<input type="email" maxLength={254} value={residentForm.email} onChange={(event) => setResidentForm({ ...residentForm, email: event.target.value })} /></label>
                      <label>Date of birth<input type="date" value={residentForm.dateOfBirth} aria-invalid={Boolean(dateOfBirthError)} aria-describedby={dateOfBirthError ? 'resident-date-of-birth-error' : undefined} onChange={(event) => { const value = event.target.value; setResidentForm({ ...residentForm, dateOfBirth: value }); setDateOfBirthError(getDateOfBirthError(value)); }} onBlur={(event) => setDateOfBirthError(getDateOfBirthError(event.target.value))} /></label>
                      {dateOfBirthError && <p id="resident-date-of-birth-error" className="form-error" role="alert">{dateOfBirthError}</p>}
                      {!residentEditingId && <label>CNIC<input inputMode="numeric" placeholder="12345-1234567-1" value={residentForm.cnic} onChange={(event) => setResidentForm({ ...residentForm, cnic: event.target.value })} /></label>}
                      <div className="button-row">
                        <button className="button primary" disabled={busy}>{residentEditingId ? 'Save changes' : 'Save resident'}</button>
                        {residentEditingId && <button className="button secondary" type="button" disabled={busy} onClick={() => { setResidentEditingId(''); setResidentForm(emptyResident); }}>Cancel</button>}
                      </div>
                    </form>
                  </section>
                )}
                <section className="panel grow">
                  <div className="panel-heading"><div><h2>Residents</h2><p>Private identity details are never shown here.</p></div><span className="count-pill">{residents.length}</span></div>
                  <form className="inline-form" onSubmit={searchResidents}>
                    <label>Search by name, ID, CNIC, phone, or email<input value={residentSearch} onChange={(event) => setResidentSearch(event.target.value)} /></label>
                    <button className="button secondary" type="submit">Search</button>
                  </form>
                  {!residents.length ? <p className="empty-state">No residents found.</p> : (
                    <div className="record-list">
                      {residents.map((resident) => (
                        <article className="record record-main" key={resident.id}>
                          <div><h3>{resident.firstName} {resident.lastName}</h3><p>{resident.phone || resident.email || 'No contact details'}{resident.cnicMasked ? ` · CNIC ${resident.cnicMasked}` : ''}</p></div>
                          <span className={`status ${resident.status.toLowerCase()}`}>{resident.status}</span>
                          <div className="button-row">
                            {can('residents', 'edit') && <button className="button secondary small" type="button" disabled={busy} onClick={() => editResident(resident)}>Edit</button>}
                            {can('residents', 'edit') && resident.email && !resident.accountLinked && <button className="button secondary small" type="button" disabled={busy} onClick={() => void mutate(`/branches/${branchId}/residents/${resident.id}/link-account`, { method: 'POST' }, 'Student account linked using the matching email.')}>Link student account</button>}
                            {can('residents', 'delete') && resident.status === 'ACTIVE' && <button className="button secondary small" type="button" disabled={busy} onClick={() => void deactivateResident(resident)}>Deactivate</button>}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {section === 'inventory' && (
              <section className="panel">
                <h2>Room and bed inventory</h2>
                <p>Configure each level in sequence: building, floor, room capacity, then beds.</p>
                {!can('inventory', 'create') && <p className="empty-state">You can view inventory but do not have permission to edit it.</p>}
                {can('inventory', 'create') && (
                  <div className="inventory-forms">
                    <form className="stack-form inventory-step" onSubmit={(event) => void createInventory(event, 'building')}>
                      <h3>1. Building</h3>
                      <label>Building name<input required maxLength={100} value={inventoryForm.buildingName} onChange={(event) => setInventoryForm({ ...inventoryForm, buildingName: event.target.value })} /></label>
                      <button className="button primary" disabled={busy}>Add building</button>
                    </form>
                    <form className="stack-form inventory-step" onSubmit={(event) => void createInventory(event, 'floor')}>
                      <h3>2. Floor</h3>
                      <label>Building<select required value={inventoryForm.buildingId} onChange={(event) => setInventoryForm({ ...inventoryForm, buildingId: event.target.value })}><option value="">Select building</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>
                      <label>Level<input required type="number" min={-2} max={100} value={inventoryForm.floorLevel} onChange={(event) => setInventoryForm({ ...inventoryForm, floorLevel: event.target.value })} /></label>
                      <label>Floor name<input maxLength={100} value={inventoryForm.floorName} onChange={(event) => setInventoryForm({ ...inventoryForm, floorName: event.target.value })} /></label>
                      <button className="button primary" disabled={busy || !buildings.length}>Add floor</button>
                    </form>
                    <form className="stack-form inventory-step" onSubmit={(event) => void createInventory(event, 'room')}>
                      <h3>3. Room</h3>
                      <label>Floor<select required value={inventoryForm.floorId} onChange={(event) => setInventoryForm({ ...inventoryForm, floorId: event.target.value })}><option value="">Select floor</option>{buildings.flatMap((building) => building.floors.map((floor) => <option key={floor.id} value={floor.id}>{building.name} · {floor.name || `Level ${floor.level}`}</option>))}</select></label>
                      <label>Room code<input required maxLength={30} value={inventoryForm.roomCode} onChange={(event) => setInventoryForm({ ...inventoryForm, roomCode: event.target.value })} /></label>
                      <label>Bed capacity<input required type="number" min={1} max={10} step={1} value={inventoryForm.bedCapacity} onChange={(event) => setInventoryForm({ ...inventoryForm, bedCapacity: event.target.value })} /></label>
                      <button className="button primary" disabled={busy || !buildings.some((building) => building.floors.length)}>Add room</button>
                    </form>
                    <form className="stack-form inventory-step" onSubmit={(event) => void createInventory(event, 'bed')}>
                      <h3>4. Bed</h3>
                      <label>Room<select required value={inventoryForm.roomId} onChange={(event) => setInventoryForm({ ...inventoryForm, roomId: event.target.value })}><option value="">Select room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.floor.building.name} · {room.code}</option>)}</select></label>
                      <label>Bed code<input required maxLength={30} value={inventoryForm.bedCode} onChange={(event) => setInventoryForm({ ...inventoryForm, bedCode: event.target.value })} /></label>
                      <button className="button primary" disabled={busy || !rooms.length}>Add bed</button>
                    </form>
                  </div>
                )}
                <h3 className="inventory-list-title">Current beds</h3>
                {!inventoryBeds.length ? <p className="empty-state">No beds configured.</p> : (
                  <div className="table-wrap"><table><thead><tr><th>Room</th><th>Bed</th><th>Status</th></tr></thead><tbody>
                    {inventoryBeds.map((bed) => <tr key={bed.id}><td>{bed.room.code}</td><td>{bed.code}</td><td><span className={`status ${bed.status.toLowerCase()}`}>{bed.status.replace('_', ' ')}</span></td></tr>)}
                  </tbody></table></div>
                )}
              </section>
            )}

            {section === 'finance' && (
              <>
                {can('reports', 'view') && (
                  <section className="panel finance-report">
                    <div className="panel-heading">
                      <div><h2>Finance report</h2><p>Period collections and current outstanding invoice balances.</p></div>
                      {financeReport && can('reports', 'export') && <button className="button secondary small" type="button" onClick={exportFinanceReport}>Export CSV</button>}
                    </div>
                    <form className="report-filters" onSubmit={(event) => { event.preventDefault(); void loadFinanceReport(); }}>
                      <label>From<input required type="date" value={reportPeriod.from} onChange={(event) => setReportPeriod((current) => ({ ...current, from: event.target.value }))} /></label>
                      <label>To<input required type="date" value={reportPeriod.to} onChange={(event) => setReportPeriod((current) => ({ ...current, to: event.target.value }))} /></label>
                      <button className="button primary" disabled={reportLoading}>{reportLoading ? 'Loading report…' : 'Run report'}</button>
                    </form>
                    {financeReport && (
                      <>
                        <div className="finance-metrics">
                          <div><span>Invoices issued</span><strong>{financeReport.issuedInvoiceCount}</strong><small>{formatMoney(financeReport.issuedAmountMinor, financeReport.currency)}</small></div>
                          <div><span>Verified payments</span><strong>{formatMoney(financeReport.verifiedPaymentsMinor, financeReport.currency)}</strong></div>
                          <div><span>Pending payments</span><strong>{formatMoney(financeReport.pendingPaymentsMinor, financeReport.currency)}</strong></div>
                          <div><span>Refunds</span><strong>{formatMoney(financeReport.refundsMinor, financeReport.currency)}</strong></div>
                          <div><span>Outstanding</span><strong>{financeReport.outstandingInvoiceCount}</strong><small>{formatMoney(financeReport.outstandingAmountMinor, financeReport.currency)}</small></div>
                          <div><span>Overdue</span><strong>{financeReport.overdueInvoiceCount}</strong><small>{formatMoney(financeReport.overdueAmountMinor, financeReport.currency)}</small></div>
                        </div>
                        {financeReport.outstandingInvoices.length > 0 && (
                          <div className="table-wrap">
                            <table><thead><tr><th>Invoice</th><th>Resident</th><th>Due date</th><th>Balance due</th></tr></thead>
                              <tbody>{financeReport.outstandingInvoices.map((item) => (
                                <tr key={item.invoiceNumber}><td>{item.invoiceNumber}</td><td>{item.residentName}</td><td>{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : '—'}</td><td>{formatMoney(item.balanceDueMinor, item.currency)}</td></tr>
                              ))}</tbody>
                            </table>
                            {financeReport.outstandingInvoicesTruncated && <p className="muted">Showing the first 100 outstanding invoices; summary totals include all invoices.</p>}
                          </div>
                        )}
                      </>
                    )}
                  </section>
                )}
                <div className="content-grid">
                {can('invoices', 'create') && can('residents', 'view') && (
                  <section className="panel">
                    <h2>Create an invoice</h2>
                    <p>Invoices use the tenant currency; enter amounts in major units. Payments remain pending until verified.</p>
                    <form className="stack-form" onSubmit={createInvoice}>
                      <label>Resident
                        <select required value={invoiceForm.residentId} onChange={(event) => setInvoiceForm({ ...invoiceForm, residentId: event.target.value })}>
                          <option value="">Select a resident</option>
                          {residents.filter((resident) => resident.status === 'ACTIVE').map((resident) => (
                            <option key={resident.id} value={resident.id}>{resident.firstName} {resident.lastName}</option>
                          ))}
                        </select>
                      </label>
                      <label>Due date<input type="date" value={invoiceForm.dueAt} onChange={(event) => setInvoiceForm({ ...invoiceForm, dueAt: event.target.value })} /></label>
                      {invoiceForm.lines.map((line, index) => (
                        <div className="invoice-line-fields" key={index}>
                          <label>Charge description<input required maxLength={200} value={line.description} onChange={(event) => setInvoiceForm((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) }))} /></label>
                          <div className="two-fields">
                            <label>Quantity<input required type="number" min={1} max={1000} step={1} value={line.quantity} onChange={(event) => setInvoiceForm((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item) }))} /></label>
                            <label>Amount per unit<input required type="number" min={0.01} step={0.01} value={line.amount} onChange={(event) => setInvoiceForm((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item) }))} /></label>
                          </div>
                          {invoiceForm.lines.length > 1 && <button className="button secondary small" type="button" onClick={() => setInvoiceForm((current) => ({ ...current, lines: current.lines.filter((_, itemIndex) => itemIndex !== index) }))}>Remove charge</button>}
                        </div>
                      ))}
                      <button className="button secondary" type="button" onClick={() => setInvoiceForm((current) => ({ ...current, lines: [...current.lines, { ...emptyInvoiceLine }] }))}>Add another charge</button>
                      <label>Notes<textarea maxLength={2000} rows={2} value={invoiceForm.notes} onChange={(event) => setInvoiceForm({ ...invoiceForm, notes: event.target.value })} /></label>
                      <button className="button primary" disabled={busy || !residents.some((resident) => resident.status === 'ACTIVE')}>Issue invoice</button>
                    </form>
                  </section>
                )}
                <section className="panel grow">
                  <div className="panel-heading"><div><h2>Invoices and payments</h2><p>Recorded payments require staff verification. Overpayments appear as resident credit.</p></div><span className="count-pill">{invoices.length}</span></div>
                  {!invoices.length ? <p className="empty-state">No invoices found for this branch.</p> : (
                    <div className="record-list">
                      {invoices.map((invoice) => (
                        <article className="record" key={invoice.id}>
                          <div className="record-main">
                            <div><h3>{invoice.invoiceNumber}</h3><p>{invoice.resident.firstName} {invoice.resident.lastName} · Issued {formatMoney(invoice.invoiceTotalMinor, invoice.currency)}</p></div>
                            <span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span>
                          </div>
                          {can('invoices', 'view') && <button className="button secondary small" type="button" disabled={Boolean(downloadingInvoiceId)} onClick={() => void downloadInvoicePdf(invoice)}>{downloadingInvoiceId === invoice.id ? 'Generating PDF…' : 'Download PDF'}</button>}
                          <div className="finance-summary">
                            <span>Due: <strong>{formatMoney(invoice.balanceDueMinor, invoice.currency)}</strong></span>
                            <span>Credit: <strong>{formatMoney(invoice.creditMinor, invoice.currency)}</strong></span>
                            {invoice.dueAt && <span>Due date: {new Date(invoice.dueAt).toLocaleDateString()}</span>}
                          </div>
                          {can('invoices', 'edit') && invoice.status === 'ISSUED'
                            && invoice.payments.every((payment) => payment.status === 'REJECTED')
                            && invoice.refundedMinor === 0 && (
                              <button className="button danger small" type="button" disabled={busy} onClick={() => void voidInvoice(invoice)}>Void invoice</button>
                          )}
                          <ul className="invoice-lines">
                            {invoice.lines.map((line) => <li key={line.id}>{line.description} × {line.quantity}<span>{formatMoney(line.lineAmountMinor, invoice.currency)}</span></li>)}
                          </ul>
                          {invoice.payments.length > 0 && (
                            <div className="payment-history">
                              <h4>Payments</h4>
                              {invoice.payments.map((payment) => (
                                <div className="payment-row" key={payment.id}>
                                  <div><strong>{formatMoney(payment.amountMinor, invoice.currency)}</strong> · {payment.method.replace('_', ' ')} · <span className={`status ${payment.status.toLowerCase()}`}>{payment.status}</span>
                                    {payment.reference && <p>Reference: {payment.reference}</p>}
                                    {payment.proofNotes && <p>{payment.proofNotes}</p>}
                                    {payment.rejectionReason && <p className="form-error">Rejected: {payment.rejectionReason}</p>}
                                  </div>
                                  {payment.proofAvailable && can('payment_proofs', 'view') && (
                                    <button className="button secondary small" type="button" onClick={() => void downloadPaymentProof(payment)}>
                                      Download proof
                                    </button>
                                  )}
                                  {payment.status === 'PENDING' && can('payments', 'verify') && (
                                    <div className="record-actions">
                                      <button className="button primary small" type="button" disabled={busy} onClick={() => void reviewFinancePayment(payment, 'VERIFIED')}>Verify</button>
                                      <button className="button danger small" type="button" disabled={busy} onClick={() => void reviewFinancePayment(payment, 'REJECTED')}>Reject</button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {can('payments', 'create') && invoice.status === 'ISSUED' && (
                            <details className="finance-action">
                              <summary>Record payment / proof</summary>
                              <form className="stack-form" onSubmit={(event) => void recordInvoicePayment(event, invoice.id)}>
                                <label>Amount<input required name="amount" type="number" min={0.01} step={0.01} /></label>
                                <label>Method<select name="method" defaultValue="CASH"><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option><option value="CARD_MANUAL">Card recorded manually</option></select></label>
                                <label>Transaction reference<input name="reference" maxLength={200} /></label>
                                <label>Proof notes<textarea name="proofNotes" maxLength={1000} rows={2} /></label>
                                <button className="button primary" disabled={busy}>Submit for verification</button>
                              </form>
                            </details>
                          )}
                          {can('payments', 'approve') && invoice.verifiedPaymentsMinor > invoice.refundedMinor && invoice.status === 'ISSUED' && (
                            <details className="finance-action">
                              <summary>Record manual refund (up to {formatMoney(invoice.verifiedPaymentsMinor - invoice.refundedMinor, invoice.currency)})</summary>
                              <form className="stack-form" onSubmit={(event) => void recordInvoiceRefund(event, invoice.id)}>
                                <label>Refund amount<input required name="amount" type="number" min={0.01} max={(invoice.verifiedPaymentsMinor - invoice.refundedMinor) / 100} step={0.01} /></label>
                                <label>Method<select name="method" defaultValue="BANK_TRANSFER"><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option><option value="CARD_MANUAL">Card recorded manually</option></select></label>
                                <label>Reference<input name="reference" maxLength={200} /></label>
                                <label>Notes<textarea name="notes" maxLength={1000} rows={2} /></label>
                                <button className="button primary" disabled={busy}>Record refund</button>
                              </form>
                            </details>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                </div>
              </>
            )}

            {section === 'mess' && (
              <div className="content-grid">
                {can('mess', 'edit') && (
                  <section className="panel">
                    <h2>Weekly mess menu</h2>
                    <p>Choose the Monday for this menu week. Leave meals blank when they are not served.</p>
                    <form className="stack-form" onSubmit={saveMessMenu}>
                      <label>Week starting Monday
                        <input
                          required
                          type="date"
                          value={menuWeek}
                          onChange={(event) => {
                            if (event.target.value) {
                              setMenuWeek(dateInput(mondayOf(new Date(`${event.target.value}T00:00:00`))));
                            }
                          }}
                        />
                      </label>
                      <div className="menu-editor">
                        {daysOfWeek.map((day, dayIndex) => (
                          <div className="menu-day" key={day}>
                            <h3>{day}</h3>
                            {mealTypes.map((meal) => {
                              const key = `${dayIndex + 1}:${meal}`;
                              return (
                                <label key={meal}>{meal[0]}{meal.slice(1).toLowerCase()}
                                  <input
                                    maxLength={500}
                                    value={menuEntries[key] ?? ''}
                                    onChange={(event) => setMenuEntries((entries) => ({
                                      ...entries,
                                      [key]: event.target.value,
                                    }))}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                      <button className="button primary" disabled={busy}>Save weekly menu</button>
                    </form>
                  </section>
                )}
                <section className="panel grow">
                  <div className="panel-heading">
                    <div><h2>Menu for the week</h2><p>Residents can view the published menu for their branch.</p></div>
                  </div>
                  <label className="week-picker">Week starting Monday
                    <input
                      type="date"
                      value={menuWeek}
                      onChange={(event) => {
                        if (event.target.value) {
                          setMenuWeek(dateInput(mondayOf(new Date(`${event.target.value}T00:00:00`))));
                        }
                      }}
                    />
                  </label>
                  {!Object.values(menuEntries).some((entry) => entry.trim()) ? (
                    <p className="empty-state">No menu has been entered for this week.</p>
                  ) : (
                    <div className="menu-week">
                      {daysOfWeek.map((day, dayIndex) => {
                        const meals = mealTypes
                          .map((meal) => ({ meal, description: menuEntries[`${dayIndex + 1}:${meal}`]?.trim() }))
                          .filter((entry) => entry.description);
                        return meals.length ? (
                          <article className="menu-day-card" key={day}>
                            <h3>{day}</h3>
                            <ul>{meals.map(({ meal, description }) => (
                              <li key={meal}><strong>{meal[0]}{meal.slice(1).toLowerCase()}</strong><span>{description}</span></li>
                            ))}</ul>
                          </article>
                        ) : null;
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}

            {section === 'complaints' && (
              <div className="content-grid">
                {can('complaints', 'create') && (
                  <section className="panel">
                    <h2>Submit a complaint</h2>
                    <p>Submit an issue and track its progress from this page.</p>
                    <form className="stack-form" onSubmit={createComplaint}>
                      <label>Subject
                        <input required maxLength={150} value={complaintForm.title} onChange={(event) => setComplaintForm({ ...complaintForm, title: event.target.value })} />
                      </label>
                      <label>Details
                        <textarea required maxLength={4000} rows={5} value={complaintForm.description} onChange={(event) => setComplaintForm({ ...complaintForm, description: event.target.value })} />
                      </label>
                      <label>Priority
                        <select value={complaintForm.priority} onChange={(event) => setComplaintForm({ ...complaintForm, priority: event.target.value })}>
                          {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                        </select>
                      </label>
                      <button className="button primary" disabled={busy}>Submit complaint</button>
                    </form>
                  </section>
                )}
                <section className="panel grow">
                  <div className="panel-heading">
                    <div><h2>{can('complaints', 'edit') ? 'Complaint queue' : 'My complaints'}</h2><p>Follow updates as complaints are assigned and resolved.</p></div>
                    <span className="count-pill">{complaints.length}</span>
                  </div>
                  {!complaints.length ? <p className="empty-state">No complaints found.</p> : (
                    <div className="record-list">
                      {complaints.map((complaint) => (
                        <article className="record" key={complaint.id}>
                          <div className="record-main">
                            <div>
                              <h3>{complaint.title}</h3>
                              <p>{complaint.description}</p>
                              {can('complaints', 'edit') && (
                                <p>Submitted by {complaint.submittedBy.email || complaint.submittedBy.phone || 'Hostel user'}</p>
                              )}
                              <p>Priority: <strong>{complaint.priority}</strong> · Submitted {new Date(complaint.createdAt).toLocaleDateString()}</p>
                            </div>
                            <span className={`status ${complaint.status.toLowerCase()}`}>{complaint.status.replace('_', ' ')}</span>
                          </div>
                          <p className="muted">
                            {complaint.assignedTo
                              ? `Assigned to ${complaint.assignedTo.email || complaint.assignedTo.phone || 'staff member'}`
                              : 'Not assigned yet'}
                          </p>
                          {can('complaints', 'assign') && complaint.status !== 'CLOSED'
                            && (!complaint.assignedToUserId || complaint.assignedToUserId === profile.id) && (
                              <button className="button secondary small" type="button" disabled={busy} onClick={() => void assignComplaint(complaint)}>
                                {complaint.assignedToUserId ? 'Assigned to you' : 'Assign to me'}
                              </button>
                          )}
                          {can('complaints', 'edit') && (
                            <div className="complaint-controls">
                              <label>Status
                                <select
                                  value={complaint.status}
                                  disabled={busy}
                                  onChange={(event) => void updateComplaint(complaint, { status: event.target.value as Complaint['status'] })}
                                >
                                  {['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((status) => (
                                    <option key={status} value={status} disabled={status === 'CLOSED' && complaint.status !== 'RESOLVED'}>{status.replace('_', ' ')}</option>
                                  ))}
                                </select>
                              </label>
                              <label>Priority
                                <select
                                  value={complaint.priority}
                                  disabled={busy}
                                  onChange={(event) => void updateComplaint(complaint, { priority: event.target.value as Complaint['priority'] })}
                                >
                                  {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                                </select>
                              </label>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {section === 'notices' && (
              <div className="content-grid">
                {can('notices', 'create') && (
                  <section className="panel">
                    <h2>Create a branch notice</h2>
                    <p>New notices start as drafts. Publish them when they are ready for residents.</p>
                    <form className="stack-form" onSubmit={createNotice}>
                      <label>Title
                        <input required maxLength={150} value={noticeForm.title} onChange={(event) => setNoticeForm({ ...noticeForm, title: event.target.value })} />
                      </label>
                      <label>Message
                        <textarea required maxLength={5000} rows={5} value={noticeForm.body} onChange={(event) => setNoticeForm({ ...noticeForm, body: event.target.value })} />
                      </label>
                      <div className="two-fields">
                        <label>Visible from<input type="date" value={noticeForm.startsAt} onChange={(event) => setNoticeForm({ ...noticeForm, startsAt: event.target.value })} /></label>
                        <label>Visible until<input type="date" value={noticeForm.endsAt} onChange={(event) => setNoticeForm({ ...noticeForm, endsAt: event.target.value })} /></label>
                      </div>
                      <button className="button primary" disabled={busy}>Save as draft</button>
                    </form>
                  </section>
                )}
                <section className="panel grow">
                  <div className="panel-heading">
                    <div><h2>{can('notices', 'edit') ? 'Branch notices' : 'Notices'}</h2><p>{can('notices', 'edit') ? 'Drafts and published notices for this branch.' : 'Current published notices for your branch.'}</p></div>
                    <span className="count-pill">{notices.length}</span>
                  </div>
                  {!notices.length ? <p className="empty-state">No notices to show.</p> : (
                    <div className="record-list">
                      {notices.map((notice) => (
                        <article className="record" key={notice.id}>
                          <div className="record-main">
                            <div><h3>{notice.title}</h3><p>{notice.body}</p>
                              {(notice.startsAt || notice.endsAt) && <p>Visible {notice.startsAt ? `from ${notice.startsAt.slice(0, 10)}` : 'immediately'}{notice.endsAt ? ` until ${notice.endsAt.slice(0, 10)}` : ''}</p>}
                            </div>
                            {can('notices', 'edit') && <span className={`status ${notice.status.toLowerCase()}`}>{notice.status}</span>}
                          </div>
                          {can('notices', 'edit') && (
                            <div className="record-actions">
                              <button className={`button ${notice.status === 'PUBLISHED' ? 'secondary' : 'primary'} small`} type="button" disabled={busy} onClick={() => void setNoticeStatus(notice, notice.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')}>
                                {notice.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                              </button>
                              <details className="notice-edit">
                                <summary>Edit notice</summary>
                                <form className="stack-form" onSubmit={(event) => void editNotice(event, notice)}>
                                  <label>Title<input required name="title" maxLength={150} defaultValue={notice.title} /></label>
                                  <label>Message<textarea required name="body" maxLength={5000} rows={4} defaultValue={notice.body} /></label>
                                  <div className="two-fields">
                                    <label>Visible from<input name="startsAt" type="date" defaultValue={notice.startsAt?.slice(0, 10) ?? ''} /></label>
                                    <label>Visible until<input name="endsAt" type="date" defaultValue={notice.endsAt?.slice(0, 10) ?? ''} /></label>
                                  </div>
                                  <button className="button secondary small" disabled={busy}>Save changes</button>
                                </form>
                              </details>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {section === 'visitors' && (
              <div className="content-grid">
                {can('visitors', 'create') && (
                  <section className="panel">
                    <h2>Register a visitor</h2>
                    <p>Visitor records include only contact details needed for the visit. New registrations require staff approval.</p>
                    <form className="stack-form" onSubmit={createVisitorVisit}>
                      <label>Visitor name
                        <input required maxLength={150} value={visitorVisitForm.visitorName} onChange={(event) => setVisitorVisitForm({ ...visitorVisitForm, visitorName: event.target.value })} />
                      </label>
                      <label>CNIC
                        <input required inputMode="numeric" pattern="\d{5}-?\d{7}-?\d" maxLength={15} placeholder="12345-1234567-1" value={visitorVisitForm.cnic} onChange={(event) => setVisitorVisitForm({ ...visitorVisitForm, cnic: event.target.value })} />
                      </label>
                      <label>Phone (optional)
                        <input type="tel" maxLength={80} value={visitorVisitForm.visitorPhone} onChange={(event) => setVisitorVisitForm({ ...visitorVisitForm, visitorPhone: event.target.value })} />
                      </label>
                      <label>Resident host
                        <select required value={visitorVisitForm.hostResidentId} onChange={(event) => setVisitorVisitForm({ ...visitorVisitForm, hostResidentId: event.target.value })}>
                          <option value="">Select an active resident</option>
                          {residents.filter((resident) => resident.status === 'ACTIVE').map((resident) => (
                            <option key={resident.id} value={resident.id}>{resident.firstName} {resident.lastName}</option>
                          ))}
                        </select>
                      </label>
                      <label>Visit purpose
                        <textarea required maxLength={500} rows={3} value={visitorVisitForm.purpose} onChange={(event) => setVisitorVisitForm({ ...visitorVisitForm, purpose: event.target.value })} />
                      </label>
                      <button className="button primary" disabled={busy || !residents.some((resident) => resident.status === 'ACTIVE')}>Register for approval</button>
                    </form>
                  </section>
                )}
                <section className="panel grow">
                  <div className="panel-heading">
                    <div><h2>Visitor register</h2><p>Approval, gate entry/exit, and branch visit history.</p></div>
                    <span className="count-pill">{visitorVisits.length}</span>
                  </div>
                  {can('visitors', 'view') && (
                    <form className="report-filters" onSubmit={searchVisitorHistory}>
                      <label>Search visitor history
                        <input maxLength={100} value={visitorSearch} onChange={(event) => setVisitorSearch(event.target.value)} placeholder="Name, phone, or CNIC" />
                      </label>
                      <button className="button secondary small" disabled={busy}>Search</button>
                      {visitorSearch && <button className="button secondary small" type="button" onClick={() => void clearVisitorSearch()}>Clear</button>}
                    </form>
                  )}
                  {!visitorVisits.length ? <p className="empty-state">No visitor records found.</p> : (
                    <div className="record-list">
                      {visitorVisits.map((visit) => (
                        <article className="record" key={visit.id}>
                          <div className="record-main">
                            <div>
                              <h3>{visit.visitorName}</h3>
                              <p>{visit.visitorPhone || 'No phone provided'} · Visiting {visit.hostResident.firstName} {visit.hostResident.lastName}</p>
                              <p>CNIC {visit.cnicMasked || 'Not provided on legacy record'}</p>
                              <p>{visit.purpose}</p>
                              <p>Registered {new Date(visit.createdAt).toLocaleString()}</p>
                              {visit.checkedInAt && <p>Checked in {new Date(visit.checkedInAt).toLocaleString()}</p>}
                              {visit.checkedOutAt && <p>Checked out {new Date(visit.checkedOutAt).toLocaleString()}</p>}
                            </div>
                            <span className={`status ${visit.status.toLowerCase()}`}>{visit.status.replace('_', ' ')}</span>
                          </div>
                          <div className="record-actions">
                            {visit.status === 'PENDING' && can('visitors', 'approve') && (
                              <>
                                <button className="button primary small" type="button" disabled={busy} onClick={() => void transitionVisitorVisit(visit, 'approve')}>Approve</button>
                                <button className="button danger small" type="button" disabled={busy} onClick={() => void transitionVisitorVisit(visit, 'reject')}>Reject</button>
                              </>
                            )}
                            {visit.status === 'APPROVED' && can('visitors', 'edit') && (
                              <button className="button primary small" type="button" disabled={busy} onClick={() => void transitionVisitorVisit(visit, 'check-in')}>Check in</button>
                            )}
                            {visit.status === 'CHECKED_IN' && can('visitors', 'edit') && (
                              <button className="button secondary small" type="button" disabled={busy} onClick={() => void transitionVisitorVisit(visit, 'check-out')}>Check out</button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {section === 'offline' && (
              <div className="content-grid">
                <section className="panel">
                  <h2>Offline sync & backup verification</h2>
                  <p>Only aggregate branch dashboard counts are cached in this browser tab session storage. Personal details, financial amounts, and visitor contact data are not cached.</p>
                  {offlineDashboard && (
                    <>
                      <div className="panel-heading">
                        <div><h3>Branch dashboard</h3></div>
                        <span className={`status ${isOnline ? 'approved' : 'pending'}`}>{isOnline ? 'ONLINE' : 'READ ONLY'}</span>
                      </div>
                      <div className="finance-summary">
                        <span>Active residents: <strong>{offlineDashboard.activeResidents}</strong></span>
                        <span>Occupied beds: <strong>{offlineDashboard.occupiedBeds}</strong></span>
                        <span>Available beds: <strong>{offlineDashboard.availableBeds}</strong></span>
                        <span>Pending admissions: <strong>{offlineDashboard.pendingAdmissions}</strong></span>
                        <span>Open complaints: <strong>{offlineDashboard.openComplaints}</strong></span>
                        <span>Pending visitors: <strong>{offlineDashboard.pendingVisitorVisits}</strong></span>
                      </div>
                      <p>Snapshot captured {new Date(offlineDashboard.capturedAt).toLocaleString()}.</p>
                    </>
                  )}
                  {!offlineDashboard && !isOnline && (
                    <p className="empty-state">No cached dashboard snapshot is available for this user and branch.</p>
                  )}
                  {offlineStatus ? (
                    <>
                      <div className="panel-heading">
                        <div><h3>Sync policy</h3></div>
                        <span className={`status ${offlineStatus.cacheEnabled ? 'approved' : 'pending'}`}>{offlineStatus.cacheEnabled ? 'CACHE ACTIVE' : 'POLICY ONLY'}</span>
                      </div>
                      <ul>
                        <li>Cache active: {offlineStatus.cacheEnabled ? 'Yes' : 'No'}</li>
                        <li>Cached data: {offlineStatus.allowedData.join(', ')}</li>
                        <li>Blocked actions: {offlineStatus.blockedActions.join(', ')}</li>
                        <li>Last verified: {new Date(offlineStatus.lastCheckedAt).toLocaleString()}</li>
                      </ul>
                      <p>{offlineStatus.summary}</p>
                      <button className="button secondary" type="button" disabled={!isOnline} onClick={() => void refreshOfflineStatus()}>Sync now</button>
                    </>
                  ) : <p className="empty-state">Offline status is not available yet.</p>}
                </section>

                <section className="panel">
                  <h2>Backup / restore verification</h2>
                  <p>This is a non-destructive configuration preflight, not a backup/restore test. Retention deletion stays owner-approved and is not enabled.</p>
                  {backupVerification ? (
                    <>
                      <div className="panel-heading">
                        <div><h3>Recovery readiness</h3></div>
                        <span className={`status ${backupVerification.configurationReady ? 'approved' : 'rejected'}`}>{backupVerification.configurationReady ? 'CONFIG READY' : 'NEEDS CONFIG'}</span>
                      </div>
                      <ul>
                        <li>Backup script available in this API runtime: {backupVerification.scriptPresent ? 'Yes' : 'No'}</li>
                        <li>BACKUP_DIR configured in this API runtime: {backupVerification.backupDirectoryConfigured ? 'Yes' : 'No'}</li>
                        <li>Retention policy configured: {backupVerification.retentionPolicyConfigured ? 'Yes' : 'No'}</li>
                        <li>Current retention value: {backupVerification.retentionPolicy}</li>
                        <li>Restore test performed: {backupVerification.restoreTestPerformed ? 'Yes' : 'No'}</li>
                      </ul>
                      {backupVerification.warnings.length > 0 && (
                        <ul>
                          {backupVerification.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                        </ul>
                      )}
                      <p>Checked at {new Date(backupVerification.reviewedAt).toLocaleString()}</p>
                      <button className="button primary" type="button" onClick={() => void verifyBackupRestore()}>Recheck backup configuration</button>
                    </>
                  ) : <p className="empty-state">Backup verification has not been loaded yet.</p>}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
