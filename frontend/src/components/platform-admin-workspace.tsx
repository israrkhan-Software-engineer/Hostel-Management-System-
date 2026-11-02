'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest, getAccessToken, setAccessToken } from '@/lib/api/client';

type TenantStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING' | 'CLOSED';
type Tenant = {
  id: string;
  name: string;
  slug: string;
  locationAddress: string;
  status: TenantStatus;
  timezone: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  userCount: number;
  activeUserCount?: number;
  owner?: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null;
};
type Dashboard = {
  tenantCount: number;
  activeTenantCount: number;
  suspendedTenantCount: number;
  totalUsers: number;
  activeUsers: number;
};
type PlatformRole = { id: string; name: string; description: string | null; isSystemRole: boolean };
type TenantUser = {
  id: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'DEACTIVATED';
  createdAt: string;
  userRoles: { role: { id: string; name: string } }[];
};
type AuditEntry = {
  id: string;
  action: string;
  targetTenantId: string | null;
  targetUserId: string | null;
  metadata: unknown;
  createdAt: string;
  platformAdmin: { email: string };
};
type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number; pageCount: number };
type Section = 'overview' | 'tenants' | 'audit';
type TenantForm = {
  name: string;
  slug: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  locationAddress: string;
  timezone: string;
  currency: string;
  ownerPassword: string;
  ownerPasswordConfirmation: string;
};
type EditTenantForm = Pick<TenantForm,
  'name' | 'slug' | 'ownerFirstName' | 'ownerLastName' | 'ownerEmail' | 'locationAddress' | 'timezone' | 'currency'>;

const initialTenantForm: TenantForm = {
  name: '',
  slug: '',
  ownerFirstName: '',
  ownerLastName: '',
  ownerEmail: '',
  locationAddress: '',
  timezone: 'Asia/Karachi',
  currency: 'PKR',
  ownerPassword: '',
  ownerPasswordConfirmation: '',
};
const tenantStatuses: TenantStatus[] = ['PROVISIONING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'CLOSED'];
const statusClass = (status: string) => status.toLowerCase().replace(/_/g, '-');
const passwordPattern = '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\\s]).{12,128}';

function slugFromName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-+$/g, '');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function PlatformAdminWorkspace() {
  const router = useRouter();
  const [section, setSection] = useState<Section>('overview');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [recentTenants, setRecentTenants] = useState<Tenant[]>([]);
  const [tenants, setTenants] = useState<Paginated<Tenant> | null>(null);
  const [audit, setAudit] = useState<Paginated<AuditEntry> | null>(null);
  const [tenantPage, setTenantPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [tenantSearch, setTenantSearch] = useState('');
  const [appliedTenantSearch, setAppliedTenantSearch] = useState('');
  const [tenantStatusFilter, setTenantStatusFilter] = useState('');
  const [tenantForm, setTenantForm] = useState<TenantForm>(initialTenantForm);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [editTenantForm, setEditTenantForm] = useState<EditTenantForm>({
    name: '',
    slug: '',
    ownerFirstName: '',
    ownerLastName: '',
    ownerEmail: '',
    locationAddress: '',
    timezone: '',
    currency: '',
  });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [ownerPasswordForm, setOwnerPasswordForm] = useState({ password: '', confirmation: '' });
  const [tenantUsers, setTenantUsers] = useState<Paginated<TenantUser> | null>(null);
  const [roles, setRoles] = useState<PlatformRole[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [appliedUserSearch, setAppliedUserSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userStatus, setUserStatus] = useState<'ACTIVE' | 'DEACTIVATED'>('ACTIVE');
  const [userRoleIds, setUserRoleIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T | null> => {
    const response = await apiRequest<T>(path, options);
    if (!response.ok) {
      setError(response.message);
      if (response.status === 401) {
        setAccessToken(null);
        router.replace('/platform-admin/login');
      }
      return null;
    }
    return response.data;
  }, [router]);

  const loadOverview = useCallback(async () => {
    const [stats, tenantsResponse] = await Promise.all([
      request<Dashboard>('/platform/admin/dashboard'),
      request<Paginated<Tenant>>('/platform/admin/tenants?page=1&pageSize=5'),
    ]);
    if (stats) setDashboard(stats);
    if (tenantsResponse) setRecentTenants(tenantsResponse.items);
  }, [request]);

  const loadTenants = useCallback(async () => {
    const params = new URLSearchParams({ page: String(tenantPage), pageSize: '10' });
    if (appliedTenantSearch) params.set('search', appliedTenantSearch);
    if (tenantStatusFilter) params.set('status', tenantStatusFilter);
    const result = await request<Paginated<Tenant>>(`/platform/admin/tenants?${params.toString()}`);
    if (result) setTenants(result);
  }, [appliedTenantSearch, request, tenantPage, tenantStatusFilter]);

  const loadAudit = useCallback(async () => {
    const result = await request<Paginated<AuditEntry>>(`/platform/admin/audit?page=${auditPage}&pageSize=20`);
    if (result) setAudit(result);
  }, [auditPage, request]);

  const loadTenantDetails = useCallback(async (tenantId: string) => {
    const [tenant, users, tenantRoles] = await Promise.all([
      request<Tenant>(`/platform/admin/tenants/${tenantId}`),
      request<Paginated<TenantUser>>(
        `/platform/admin/tenants/${tenantId}/users?page=${userPage}&pageSize=10${
          appliedUserSearch ? `&search=${encodeURIComponent(appliedUserSearch)}` : ''
        }`,
      ),
      request<PlatformRole[]>(`/platform/admin/tenants/${tenantId}/roles`),
    ]);
    if (tenant) {
      setSelectedTenant(tenant);
      setEditTenantForm({
        name: tenant.name,
        slug: tenant.slug,
        ownerFirstName: tenant.owner?.firstName ?? '',
        ownerLastName: tenant.owner?.lastName ?? '',
        ownerEmail: tenant.owner?.email ?? '',
        locationAddress: tenant.locationAddress,
        timezone: tenant.timezone,
        currency: tenant.currency,
      });
    }
    if (users) setTenantUsers(users);
    if (tenantRoles) setRoles(tenantRoles);
  }, [appliedUserSearch, request, userPage]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/platform-admin/login');
      return;
    }
    setLoading(true);
    void loadOverview().finally(() => setLoading(false));
  }, [loadOverview, router]);

  useEffect(() => {
    if (section === 'tenants' && getAccessToken()) void loadTenants();
  }, [loadTenants, section]);

  useEffect(() => {
    if (section === 'audit' && getAccessToken()) void loadAudit();
  }, [loadAudit, section]);

  useEffect(() => {
    if (selectedTenantId && getAccessToken()) void loadTenantDetails(selectedTenantId);
  }, [loadTenantDetails, selectedTenantId]);

  function clearNotices() {
    setError('');
    setSuccess('');
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotices();
    if (tenantForm.ownerPassword !== tenantForm.ownerPasswordConfirmation) {
      setError('Owner password and confirmation do not match.');
      return;
    }
    setSaving(true);
    const created = await request<Tenant>('/platform/admin/tenants', {
      method: 'POST',
      body: JSON.stringify({
        ...tenantForm,
        name: tenantForm.name.trim(),
        slug: tenantForm.slug.trim().toLowerCase(),
        ownerFirstName: tenantForm.ownerFirstName.trim(),
        ownerLastName: tenantForm.ownerLastName.trim(),
        ownerEmail: tenantForm.ownerEmail.trim().toLowerCase(),
        locationAddress: tenantForm.locationAddress.trim(),
        currency: tenantForm.currency.trim().toUpperCase(),
      }),
    });
    setSaving(false);
    if (!created) return;
    setTenantForm(initialTenantForm);
    setSlugManuallyEdited(false);
    setSuccess(`Organization "${created.name}" created in provisioning status.`);
    setTenantPage(1);
    await Promise.all([loadTenants(), loadOverview()]);
  }

  async function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant) return;
    clearNotices();
    setSaving(true);
    const updated = await request<Tenant>(`/platform/admin/tenants/${selectedTenant.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: editTenantForm.name.trim(),
        slug: editTenantForm.slug.trim().toLowerCase(),
        ...(editTenantForm.ownerFirstName.trim()
          ? { ownerFirstName: editTenantForm.ownerFirstName.trim() }
          : {}),
        ...(editTenantForm.ownerLastName.trim()
          ? { ownerLastName: editTenantForm.ownerLastName.trim() }
          : {}),
        ...(editTenantForm.ownerEmail.trim()
          ? { ownerEmail: editTenantForm.ownerEmail.trim().toLowerCase() }
          : {}),
        ...(editTenantForm.locationAddress.trim()
          ? { locationAddress: editTenantForm.locationAddress.trim() }
          : {}),
        timezone: editTenantForm.timezone.trim(),
        currency: editTenantForm.currency.trim().toUpperCase(),
      }),
    });
    setSaving(false);
    if (!updated) return;
    setSuccess('Organization details saved.');
    await Promise.all([loadTenantDetails(selectedTenant.id), loadTenants(), loadOverview()]);
  }

  async function resetOwnerPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant) return;
    if (ownerPasswordForm.password !== ownerPasswordForm.confirmation) {
      setError('Password and confirmation do not match.');
      return;
    }
    if (!window.confirm(`Reset the owner password for "${selectedTenant.name}"? Existing owner sessions will be revoked.`)) {
      return;
    }
    clearNotices();
    setSaving(true);
    const result = await request<{ success: boolean }>(
      `/platform/admin/tenants/${selectedTenant.id}/owner/password`,
      {
        method: 'POST',
        body: JSON.stringify({
          newPassword: ownerPasswordForm.password,
          confirmation: ownerPasswordForm.confirmation,
        }),
      },
    );
    setSaving(false);
    if (!result) return;
    setOwnerPasswordForm({ password: '', confirmation: '' });
    setShowPasswordReset(false);
    setSuccess('Owner password reset. Existing owner sessions were revoked.');
  }

  async function updateTenantStatus(status: 'ACTIVE' | 'SUSPENDED') {
    if (!selectedTenant) return;
    const action = status === 'SUSPENDED' ? 'suspend' : 'reactivate';
    const warning = status === 'SUSPENDED'
      ? 'Users in this organization will lose access immediately.'
      : 'Users in this organization will regain access.';
    if (!window.confirm(`Are you sure you want to ${action} "${selectedTenant.name}"? ${warning}`)) return;
    clearNotices();
    setSaving(true);
    const updated = await request<Tenant>(`/platform/admin/tenants/${selectedTenant.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setSaving(false);
    if (!updated) return;
    setSuccess(`Organization status changed to ${status.toLowerCase()}.`);
    await Promise.all([loadTenantDetails(selectedTenant.id), loadTenants(), loadOverview()]);
  }

  async function updateTenantUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant || !selectedUserId) return;
    const selectedUser = tenantUsers?.items.find(({ id }) => id === selectedUserId);
    const identity = selectedUser?.email ?? selectedUser?.phone ?? selectedUserId;
    if (!window.confirm(`Apply these status and role changes to ${identity}?`)) return;
    clearNotices();
    setSaving(true);
    const updated = await request<TenantUser>(
      `/platform/admin/tenants/${selectedTenant.id}/users/${selectedUserId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: userStatus, roleIds: userRoleIds }),
      },
    );
    setSaving(false);
    if (!updated) return;
    setSuccess('User access updated.');
    setSelectedUserId('');
    await Promise.all([loadTenantDetails(selectedTenant.id), loadOverview()]);
  }

  function selectUser(user: TenantUser) {
    setSelectedUserId(user.id);
    setUserStatus(user.status);
    setUserRoleIds(user.userRoles.map(({ role }) => role.id));
  }

  function logout() {
    setAccessToken(null);
    router.replace('/platform-admin/login');
  }

  const pageCount = (data: Paginated<unknown> | null) => Math.max(data?.pageCount ?? 1, 1);

  if (loading) {
    return <main className="workspace-loading" aria-live="polite">Loading platform dashboard…</main>;
  }

  return (
    <main className="platform-page">
      <header className="platform-header">
        <a className="platform-brand" href="/system-admin">HMS <span>PLATFORM</span></a>
        <div className="platform-header-actions">
          <span>Super administrator</span>
          <button type="button" className="button secondary small" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="platform-layout">
        <aside className="platform-sidebar" aria-label="Platform navigation">
          <p className="platform-sidebar-label">WORKSPACE</p>
          {([
            ['overview', 'Overview'],
            ['tenants', 'Organizations'],
            ['audit', 'Audit log'],
          ] as const).map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={`platform-nav-item${section === key ? ' active' : ''}`}
              onClick={() => { clearNotices(); setSection(key); }}
              aria-current={section === key ? 'page' : undefined}
            >
              {label}
            </button>
          ))}
          <div className="platform-sidebar-note">
            Platform access is isolated from tenant staff accounts and protected by administrator credentials and authenticator verification.
          </div>
        </aside>

        <section className="platform-main">
          <div className="platform-title-row">
            <div>
              <span className="eyebrow">PLATFORM ADMINISTRATION</span>
              <h1>{section === 'overview' ? 'Overview' : section === 'tenants' ? 'Organizations' : 'Audit log'}</h1>
              <p>Manage organizations and their access across the HMS platform.</p>
            </div>
            <button type="button" className="button secondary" onClick={() => {
              clearNotices();
              if (section === 'overview') void loadOverview();
              if (section === 'tenants') void loadTenants();
              if (section === 'audit') void loadAudit();
            }}>
              Refresh data
            </button>
          </div>

          {error && <p className="notice error" role="alert">{error}</p>}
          {success && <p className="notice success" role="status">{success}</p>}

          {section === 'overview' && (
            <>
              <div className="platform-metrics">
                {[
                  ['Organizations', dashboard?.tenantCount],
                  ['Active', dashboard?.activeTenantCount],
                  ['Suspended', dashboard?.suspendedTenantCount],
                  ['Total users', dashboard?.totalUsers],
                  ['Active users', dashboard?.activeUsers],
                ].map(([label, value]) => (
                  <article className="platform-metric" key={label}>
                    <span>{label}</span>
                    <strong>{value ?? '—'}</strong>
                  </article>
                ))}
              </div>
              <section className="panel platform-panel">
                <div className="panel-heading">
                  <div><h2>Recently added organizations</h2><p>Latest organizations on the platform.</p></div>
                  <button type="button" className="button secondary small" onClick={() => setSection('tenants')}>
                    View all
                  </button>
                </div>
                <TenantTable tenants={recentTenants} onSelect={(tenant) => {
                  setSelectedTenantId(tenant.id);
                  setSection('tenants');
                }} />
              </section>
            </>
          )}

          {section === 'tenants' && (
            <>
              <div className="platform-grid">
                <section className="panel platform-panel">
                  <div className="panel-heading">
                    <div><h2>Create organization</h2><p>New organizations start in provisioning status.</p></div>
                  </div>
                  <form className="platform-form" onSubmit={createTenant}>
                    <label>Organization name
                      <input required minLength={2} maxLength={120} value={tenantForm.name}
                        onChange={(event) => {
                          const name = event.target.value;
                          setTenantForm((current) => ({
                            ...current,
                            name,
                            ...(!slugManuallyEdited ? { slug: slugFromName(name) } : {}),
                          }));
                        }} />
                    </label>
                    <label>Organization slug
                      <input required minLength={3} maxLength={60} pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        value={tenantForm.slug}
                        onChange={(event) => {
                          setSlugManuallyEdited(true);
                          setTenantForm({ ...tenantForm, slug: event.target.value.toLowerCase() });
                        }}
                        aria-describedby="slug-help" />
                      <small id="slug-help" className="muted">Lowercase letters, numbers, and single hyphens.</small>
                    </label>
                    <div className="two-fields">
                      <label>Owner first name
                        <input required minLength={2} maxLength={100} value={tenantForm.ownerFirstName}
                          onChange={(event) => setTenantForm({ ...tenantForm, ownerFirstName: event.target.value })} />
                      </label>
                      <label>Owner last name
                        <input required minLength={2} maxLength={100} value={tenantForm.ownerLastName}
                          onChange={(event) => setTenantForm({ ...tenantForm, ownerLastName: event.target.value })} />
                      </label>
                    </div>
                    <label>Owner email
                      <input required type="email" maxLength={254} autoComplete="email" value={tenantForm.ownerEmail}
                        onChange={(event) => setTenantForm({ ...tenantForm, ownerEmail: event.target.value })} />
                    </label>
                    <label>Hostel location / address
                      <textarea required maxLength={500} value={tenantForm.locationAddress}
                        onChange={(event) => setTenantForm({ ...tenantForm, locationAddress: event.target.value })} />
                    </label>
                    <div className="two-fields">
                      <label>Temporary owner password
                        <input required type="password" minLength={12} maxLength={128} pattern={passwordPattern}
                          autoComplete="new-password" value={tenantForm.ownerPassword}
                          onChange={(event) => setTenantForm({ ...tenantForm, ownerPassword: event.target.value })} />
                      </label>
                      <label>Confirm temporary password
                        <input required type="password" minLength={12} maxLength={128} pattern={passwordPattern}
                          autoComplete="new-password" value={tenantForm.ownerPasswordConfirmation}
                          onChange={(event) =>
                            setTenantForm({ ...tenantForm, ownerPasswordConfirmation: event.target.value })} />
                      </label>
                    </div>
                    <small className="muted">Use at least 12 characters with upper- and lowercase letters, a number, and a symbol.</small>
                    <div className="two-fields">
                      <label>Timezone
                        <input required maxLength={100} value={tenantForm.timezone}
                          onChange={(event) => setTenantForm({ ...tenantForm, timezone: event.target.value })} />
                      </label>
                      <label>Currency
                        <input required pattern="[A-Z]{3}" maxLength={3} value={tenantForm.currency}
                          onChange={(event) => setTenantForm({ ...tenantForm, currency: event.target.value.toUpperCase() })} />
                      </label>
                    </div>
                    <button className="button primary" type="submit" disabled={saving}>Create organization</button>
                  </form>
                </section>

                <section className="panel platform-panel">
                  <div className="panel-heading">
                    <div><h2>Organization directory</h2><p>{tenants?.total ?? 0} matching organizations</p></div>
                  </div>
                  <form className="platform-filters" onSubmit={(event) => {
                    event.preventDefault();
                    setTenantPage(1);
                    setAppliedTenantSearch(tenantSearch.trim());
                  }}>
                    <label className="platform-search">Search
                      <input type="search" maxLength={100} placeholder="Name or slug"
                        value={tenantSearch} onChange={(event) => setTenantSearch(event.target.value)} />
                    </label>
                    <label>Status
                      <select value={tenantStatusFilter} onChange={(event) => {
                        setTenantPage(1);
                        setTenantStatusFilter(event.target.value);
                      }}>
                        <option value="">All statuses</option>
                        {tenantStatuses.map((status) => <option value={status} key={status}>{status}</option>)}
                      </select>
                    </label>
                    <button className="button secondary" type="submit">Search</button>
                  </form>
                  <TenantTable tenants={tenants?.items ?? []} selectedId={selectedTenantId}
                    onSelect={(tenant) => setSelectedTenantId(tenant.id)} />
                  <Pagination page={tenantPage} pageCount={pageCount(tenants)}
                    onPage={(page) => setTenantPage(page)} />
                </section>
              </div>

              {selectedTenantId && (
                <section className="panel platform-panel platform-tenant-detail">
                  <div className="panel-heading">
                    <div>
                      <h2>{selectedTenant?.name ?? 'Organization details'}</h2>
                      <p>{selectedTenant?.slug ?? 'Loading details…'} · {selectedTenant?.id}</p>
                    </div>
                    <button type="button" className="button secondary small" onClick={() => {
                      setSelectedTenantId('');
                      setSelectedTenant(null);
                      setSelectedUserId('');
                    }}>Close details</button>
                  </div>
                  {selectedTenant && (
                    <>
                      <div className="platform-detail-summary">
                        <span className={`status ${statusClass(selectedTenant.status)}`}>{selectedTenant.status}</span>
                        <span>{selectedTenant.userCount} users · {selectedTenant.activeUserCount ?? 0} active</span>
                        <span>Created {formatDate(selectedTenant.createdAt)}</span>
                      </div>
                      <form className="platform-edit-form" onSubmit={saveTenant}>
                        <label>Name
                          <input required minLength={2} maxLength={120} value={editTenantForm.name}
                            onChange={(event) => setEditTenantForm({ ...editTenantForm, name: event.target.value })} />
                        </label>
                        <label>Organization slug
                          <input required minLength={3} maxLength={60} pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                            value={editTenantForm.slug}
                            onChange={(event) =>
                              setEditTenantForm({ ...editTenantForm, slug: event.target.value.toLowerCase() })} />
                        </label>
                        {selectedTenant.owner ? (
                          <>
                            <label>Owner first name
                              <input required={Boolean(selectedTenant.owner.firstName)} minLength={2}
                                maxLength={100} value={editTenantForm.ownerFirstName}
                                onChange={(event) =>
                                  setEditTenantForm({ ...editTenantForm, ownerFirstName: event.target.value })} />
                            </label>
                            <label>Owner last name
                              <input required={Boolean(selectedTenant.owner.lastName)} minLength={2}
                                maxLength={100} value={editTenantForm.ownerLastName}
                                onChange={(event) =>
                                  setEditTenantForm({ ...editTenantForm, ownerLastName: event.target.value })} />
                            </label>
                            <label>Owner email
                              <input required={Boolean(selectedTenant.owner.email)} type="email" maxLength={254}
                                autoComplete="email" value={editTenantForm.ownerEmail}
                                onChange={(event) =>
                                  setEditTenantForm({ ...editTenantForm, ownerEmail: event.target.value })} />
                            </label>
                          </>
                        ) : (
                          <p className="muted">
                            No owner account is associated with this organization. Owner changes and password resets are unavailable.
                          </p>
                        )}
                        <label>Hostel location / address
                          <textarea maxLength={500} value={editTenantForm.locationAddress}
                            onChange={(event) =>
                              setEditTenantForm({ ...editTenantForm, locationAddress: event.target.value })} />
                        </label>
                        <label>Timezone
                          <input required maxLength={100} value={editTenantForm.timezone}
                            onChange={(event) => setEditTenantForm({ ...editTenantForm, timezone: event.target.value })} />
                        </label>
                        <label>Currency
                          <input required pattern="[A-Z]{3}" maxLength={3} value={editTenantForm.currency}
                            onChange={(event) => setEditTenantForm({ ...editTenantForm, currency: event.target.value.toUpperCase() })} />
                        </label>
                        <button className="button primary" type="submit" disabled={saving}>Save details</button>
                        {selectedTenant.status !== 'OFFBOARDING' && selectedTenant.status !== 'CLOSED' && (
                          <button type="button" className={`button ${selectedTenant.status === 'SUSPENDED' ? 'primary' : 'danger'}`}
                            disabled={saving} onClick={() => void updateTenantStatus(
                              selectedTenant.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
                            )}>
                            {selectedTenant.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                          </button>
                        )}
                      </form>

                      {selectedTenant.owner && (
                        <section className="platform-owner-password">
                          <div className="panel-heading">
                            <div>
                              <h3>Owner password</h3>
                              <p className="muted">Resetting the password revokes the owner’s active sessions.</p>
                            </div>
                            <button type="button" className="button secondary small"
                              onClick={() => {
                                setShowPasswordReset((shown) => !shown);
                                setOwnerPasswordForm({ password: '', confirmation: '' });
                              }}>
                              {showPasswordReset ? 'Cancel reset' : 'Reset Owner Password'}
                            </button>
                          </div>
                          {showPasswordReset && (
                            <form className="platform-edit-form" onSubmit={resetOwnerPassword}>
                              <label>New temporary password
                                <input required type="password" minLength={12} maxLength={128} pattern={passwordPattern}
                                  autoComplete="new-password" value={ownerPasswordForm.password}
                                  onChange={(event) =>
                                    setOwnerPasswordForm({ ...ownerPasswordForm, password: event.target.value })} />
                              </label>
                              <label>Confirm new password
                                <input required type="password" minLength={12} maxLength={128} pattern={passwordPattern}
                                  autoComplete="new-password" value={ownerPasswordForm.confirmation}
                                  onChange={(event) =>
                                    setOwnerPasswordForm({ ...ownerPasswordForm, confirmation: event.target.value })} />
                              </label>
                              <small className="muted">
                                At least 12 characters with upper- and lowercase letters, a number, and a symbol.
                              </small>
                              <button className="button primary" type="submit" disabled={saving}>Set new password</button>
                            </form>
                          )}
                        </section>
                      )}

                      <div className="platform-users-heading">
                        <div><h3>Organization users</h3><p className="muted">Change account status or assigned roles.</p></div>
                        <form className="platform-user-search" onSubmit={(event) => {
                          event.preventDefault();
                          setUserPage(1);
                          setAppliedUserSearch(userSearch.trim());
                        }}>
                          <input type="search" maxLength={100} aria-label="Search users"
                            placeholder="Search email, phone, or ID" value={userSearch}
                            onChange={(event) => setUserSearch(event.target.value)} />
                          <button className="button secondary small" type="submit">Search</button>
                        </form>
                      </div>
                      <TenantUserTable users={tenantUsers?.items ?? []} selectedId={selectedUserId} onSelect={selectUser} />
                      <Pagination page={userPage} pageCount={pageCount(tenantUsers)} onPage={setUserPage} />

                      {selectedUserId && (
                        <form className="platform-user-editor" onSubmit={updateTenantUser}>
                          <h3>Edit selected user access</h3>
                          <label>Status
                            <select value={userStatus} onChange={(event) =>
                              setUserStatus(event.target.value as 'ACTIVE' | 'DEACTIVATED')}>
                              <option value="ACTIVE">Active</option>
                              <option value="DEACTIVATED">Deactivated</option>
                            </select>
                          </label>
                          <fieldset>
                            <legend>Assigned roles</legend>
                            <div className="platform-role-list">
                              {roles.map((role) => (
                                <label className="platform-role-option" key={role.id}>
                                  <input type="checkbox" checked={userRoleIds.includes(role.id)}
                                    onChange={(event) => setUserRoleIds((current) =>
                                      event.target.checked
                                        ? [...current, role.id]
                                        : current.filter((id) => id !== role.id),
                                    )} />
                                  <span>{role.name}{role.isSystemRole ? ' · system' : ''}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          <button className="button primary" type="submit" disabled={saving}>Save user access</button>
                        </form>
                      )}
                    </>
                  )}
                </section>
              )}
            </>
          )}

          {section === 'audit' && (
            <section className="panel platform-panel">
              <div className="panel-heading">
                <div><h2>Administrator activity</h2><p>Recent actions performed by your platform account.</p></div>
              </div>
              <AuditTable entries={audit?.items ?? []} />
              <Pagination page={auditPage} pageCount={pageCount(audit)} onPage={setAuditPage} />
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function TenantTable({
  tenants,
  selectedId,
  onSelect,
}: {
  tenants: Tenant[];
  selectedId?: string;
  onSelect: (tenant: Tenant) => void;
}) {
  if (!tenants.length) return <p className="empty-state">No organizations found.</p>;
  return (
    <div className="table-wrap">
      <table className="platform-table">
        <thead><tr><th>Organization</th><th>Status</th><th>Users</th><th>Created</th></tr></thead>
        <tbody>
          {tenants.map((tenant) => (
            <tr key={tenant.id} className={selectedId === tenant.id ? 'selected' : ''}>
              <td><button type="button" className="platform-row-link" onClick={() => onSelect(tenant)}>
                <strong>{tenant.name}</strong><span>{tenant.slug}</span>
              </button></td>
              <td><span className={`status ${statusClass(tenant.status)}`}>{tenant.status}</span></td>
              <td>{tenant.userCount}</td>
              <td>{formatDate(tenant.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TenantUserTable({
  users,
  selectedId,
  onSelect,
}: {
  users: TenantUser[];
  selectedId: string;
  onSelect: (user: TenantUser) => void;
}) {
  if (!users.length) return <p className="empty-state">No users found for this organization.</p>;
  return (
    <div className="table-wrap">
      <table className="platform-table">
        <thead><tr><th>User</th><th>Status</th><th>Roles</th><th>Created</th><th>Action</th></tr></thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className={selectedId === user.id ? 'selected' : ''}>
              <td><strong>{user.email ?? user.phone ?? 'No contact details'}</strong>
                <span className="platform-cell-subtitle">{user.email && user.phone ? user.phone : user.id}</span></td>
              <td><span className={`status ${statusClass(user.status)}`}>{user.status}</span></td>
              <td>{user.userRoles.map(({ role }) => role.name).join(', ') || 'None'}</td>
              <td>{formatDate(user.createdAt)}</td>
              <td><button type="button" className="button secondary small" onClick={() => onSelect(user)}>
                Edit access
              </button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <p className="empty-state">No audit entries found.</p>;
  return (
    <div className="table-wrap">
      <table className="platform-table">
        <thead><tr><th>Action</th><th>Organization</th><th>User</th><th>Administrator</th><th>Date</th><th>Details</th></tr></thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td><code>{entry.action}</code></td>
              <td>{entry.targetTenantId ?? '—'}</td>
              <td>{entry.targetUserId ?? '—'}</td>
              <td>{entry.platformAdmin.email}</td>
              <td>{formatDate(entry.createdAt)}</td>
              <td><details><summary>View</summary><pre>{JSON.stringify(entry.metadata, null, 2)}</pre></details></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="platform-pagination">
      <button type="button" className="button secondary small" disabled={page <= 1}
        onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {pageCount}</span>
      <button type="button" className="button secondary small" disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
