'use client';

import Icon from './ui/icon';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api/client';

type Permission = { id: string; module: string; action: string };
type Role = {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissions: { permission: Permission }[];
};
type User = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'DEACTIVATED';
  userRoles: { role: { id: string; name: string } }[];
};
type UserPage = { items: User[]; total: number };
type RoleList = { roles: Role[]; permissions: Permission[] };
type SubscriptionSummary = {
  subscription: { status: string; periodEndsAt: string; trialEndsAt: string | null; plan: { name: string } } | null;
  usage: { activeUsers: number; userLimit: number; branches: number; branchLimit: number };
};

const initialCreate = { firstName: '', lastName: '', email: '', phone: '', temporaryPassword: '' };
const strongPasswordPattern = '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\\s]).{12,128}';

export default function TenantManagementPanel({ permissions: grantedPermissions }: { permissions: string[] }) {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [createForm, setCreateForm] = useState(initialCreate);
  const [createRoles, setCreateRoles] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editStatus, setEditStatus] = useState<User['status']>('ACTIVE');
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editProfile, setEditProfile] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [resetPassword, setResetPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Auto-dismiss messages after 6s and errors after 8s
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 6000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 8000);
    return () => clearTimeout(timer);
  }, [error]);
  const [busy, setBusy] = useState(false);
  const [showAddStaff, setShowAddStaff] = useState(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T | null> => {
    const response = await apiRequest<T>(path, init);
    if (!response.ok) {
      setError(response.message);
      return null;
    }
    return response.data;
  }, []);

  const load = useCallback(async () => {
    const [userPage, roleList, subscriptionSummary] = await Promise.all([
      request<UserPage>('/tenant-management/users?page=1&pageSize=100'),
      request<RoleList>('/tenant-management/roles'),
      request<SubscriptionSummary>('/tenant-management/subscription'),
    ]);
    if (userPage) setUsers(userPage.items);
    if (roleList) {
      setRoles(roleList.roles);
      setPermissions(roleList.permissions);
      if (roleList.roles.length > 0) {
        setCreateRoles((curr) => curr.length ? curr : [roleList.roles[0].id]);
      }
    }
    if (subscriptionSummary) setSubscription(subscriptionSummary);
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  const can = (module: string, action: string) => grantedPermissions.includes(`${module}:${action}`);

  function chooseRole(role?: Role) {
    setRoleId(role?.id ?? '');
    setRoleName(role?.name ?? '');
    setRoleDescription(role?.description ?? '');
    setRolePermissions(role?.permissions.map(({ permission }) => permission.id) ?? []);
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.email.trim() && !createForm.phone.trim()) {
      setError('Provide an email address or phone number.');
      return;
    }
    setError('');
    setMessage('');
    setBusy(true);
    const result = await request<User>('/tenant-management/users', {
      method: 'POST',
      body: JSON.stringify({
        ...createForm,
        email: createForm.email.trim() || undefined,
        phone: createForm.phone.trim() || undefined,
        roleIds: createRoles,
      }),
    });
    setBusy(false);
    if (!result) return;
    setCreateForm(initialCreate);
    setCreateRoles([]);
    setMessage('Staff account created.');
    await load();
  }

  async function updateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;
    setError('');
    setMessage('');
    setBusy(true);
    const result = await request<User>(`/tenant-management/users/${selectedUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...editProfile,
        email: editProfile.email.trim() || undefined,
        phone: editProfile.phone.trim() || undefined,
        status: editStatus,
        roleIds: editRoles,
      }),
    });
    setBusy(false);
    if (!result) return;
    setSelectedUser(null);
    setMessage('Staff access updated. Deactivation revokes all active sessions.');
    await load();
  }

  async function changeStaffPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;
    setError('');
    setBusy(true);
    const result = await request<{ success: boolean }>(
      `/tenant-management/users/${selectedUser.id}/password`,
      { method: 'POST', body: JSON.stringify({ newPassword: resetPassword }) },
    );
    setBusy(false);
    if (!result) return;
    setResetPassword('');
    setMessage('Password reset and active sessions revoked.');
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    const result = await request<Role>(
      roleId ? `/tenant-management/roles/${roleId}` : '/tenant-management/roles',
      {
        method: roleId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: roleName,
          description: roleDescription,
          permissionIds: rolePermissions,
        }),
      },
    );
    setBusy(false);
    if (!result) return;
    chooseRole();
    setMessage('Role permissions saved.');
    await load();
  }

  async function deleteRole() {
    if (!roleId || !window.confirm('Delete this custom role? It must not be assigned to any staff account.')) return;
    setError('');
    setBusy(true);
    const result = await request<{ success: boolean }>(`/tenant-management/roles/${roleId}`, { method: 'DELETE' });
    setBusy(false);
    if (!result) return;
    chooseRole();
    setMessage('Role deleted.');
    await load();
  }

  const toggle = (values: string[], id: string, setValues: (next: string[]) => void) => {
    setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  };

    return (
    <div className="tenant-management" style={{ display: 'grid', gap: '24px' }}>
      {error && (
        <div className="notice error" role="alert">
          <Icon name="alert" size={18} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="notice-close" onClick={() => setError('')} aria-label="Dismiss error">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          <Icon name="checkCircle" size={18} />
          <span style={{ flex: 1 }}>{message}</span>
          <button type="button" className="notice-close" onClick={() => setMessage('')} aria-label="Dismiss message">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {/* Basic Information / Subscription Overview Cards */}
      <section className="panel basic-info-panel">
        <div className="panel-heading">
          <div>
            <h2>Tenant &amp; Subscription Information</h2>
            <p>System capacity, active license terms, and resource quotas.</p>
          </div>
          {subscription && (
            <span className={`status ${subscription.subscription?.status === 'ACTIVE' ? 'approved' : 'pending'}`}>
              {subscription.subscription?.status ?? 'TRIAL'}
            </span>
          )}
        </div>

        <div className="stats" style={{ marginBottom: 0 }}>
          <article className="stat accent">
            <span className="label">
              <span>Current Plan</span>
            </span>
            <strong className="value" style={{ fontSize: '22px' }}>
              {subscription?.subscription?.plan.name ?? 'Standard License'}
            </strong>
            <span className="hint">
              {subscription?.subscription?.trialEndsAt || subscription?.subscription?.periodEndsAt
                ? `Valid through ${new Date(subscription.subscription.trialEndsAt ?? subscription.subscription.periodEndsAt).toLocaleDateString()}`
                : 'Active deployment'}
            </span>
          </article>

          <article className="stat">
            <span className="label">
              <span>Staff Accounts</span>
            </span>
            <strong className="value">
              {subscription?.usage.activeUsers ?? users.length} <small style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-muted)' }}>/ {subscription?.usage.userLimit ?? 50}</small>
            </strong>
            <span className="hint">
              {users.filter(u => u.status === 'ACTIVE').length} active staff members
            </span>
          </article>

          <article className="stat">
            <span className="label">
              <span>Allocated Branches</span>
            </span>
            <strong className="value">
              {subscription?.usage.branches ?? 1} <small style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-muted)' }}>/ {subscription?.usage.branchLimit ?? 5}</small>
            </strong>
            <span className="hint">Multi-branch operational quota</span>
          </article>

          <article className="stat">
            <span className="label">
              <span>Security Roles</span>
            </span>
            <strong className="value">
              {roles.length}
            </strong>
            <span className="hint">
              {roles.filter(r => !r.isSystemRole).length} custom, {roles.filter(r => r.isSystemRole).length} built-in
            </span>
          </article>
        </div>
      </section>

      {/* ALREADY ENROLLED STAFF SECTION */}
      <section className="panel already-enrolled-section">
        <div className="panel-heading">
          <div>
            <h2>Enrolled Staff Accounts</h2>
            <p>Manage staff credentials, access permissions, and account status.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="count-pill">{users.length}</span>
            {can('users', 'create') && (
              <button
                type="button"
                className="button primary small"
                onClick={() => {
                  setShowAddStaff(!showAddStaff);
                  setSelectedUser(null);
                }}
              >
                {showAddStaff ? <><Icon name="close" size={14} style={{ marginRight: '6px' }} /> Close Form</> : <><Icon name="plus" size={14} style={{ marginRight: '6px' }} /> Add New Staff</>}
              </button>
            )}
          </div>
        </div>

        {/* REGISTRATION FORM (COLLAPSIBLE / TOGGLEABLE) */}
        {showAddStaff && can('users', 'create') && (
          <div className="staff-registration-box" style={{ marginBottom: '24px', padding: '20px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-lg)', border: '2px solid var(--color-primary)' }}>
            <div className="panel-heading" style={{ marginBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0 }}>Register New Staff Account</h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px' }}>Enter staff details and choose their operational roles.</p>
              </div>
              <button className="button secondary small" type="button" onClick={() => setShowAddStaff(false)}><Icon name="close" size={14} /></button>
            </div>
            <form className="stack-form" onSubmit={(event) => void createUser(event)}>
              <div className="form-row">
                <label>First name
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={createForm.firstName}
                    placeholder="e.g. Ahmad"
                    onChange={(event) => setCreateForm({ ...createForm, firstName: event.target.value })}
                  />
                </label>
                <label>Last name
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={createForm.lastName}
                    placeholder="e.g. Khan"
                    onChange={(event) => setCreateForm({ ...createForm, lastName: event.target.value })}
                  />
                </label>
              </div>

              <div className="form-row">
                <label>Email address
                  <input
                    type="email"
                    maxLength={254}
                    value={createForm.email}
                    placeholder="staff@hostel.com"
                    onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
                  />
                </label>
                <label>Phone number
                  <input
                    type="tel"
                    value={createForm.phone}
                    placeholder="+92 300 1234567"
                    onChange={(event) => setCreateForm({ ...createForm, phone: event.target.value })}
                  />
                </label>
              </div>

              <label>Temporary password
                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={128}
                  pattern={strongPasswordPattern}
                  autoComplete="new-password"
                  value={createForm.temporaryPassword}
                  placeholder="Min 12 characters (uppercase, lowercase, number, special)"
                  onChange={(event) => setCreateForm({ ...createForm, temporaryPassword: event.target.value })}
                />
              </label>

              <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
                <legend style={{ fontWeight: 700, fontSize: '13px', padding: '0 6px' }}>Assigned Roles (Select at least one)</legend>
                <div className="permission-check-grid">
                  {roles.map((role) => (
                    <label className="inline-check" key={role.id}>
                      <input
                        type="checkbox"
                        checked={createRoles.includes(role.id)}
                        onChange={() => toggle(createRoles, role.id, setCreateRoles)}
                      />
                      <span><strong>{role.name}</strong>{role.isSystemRole ? ' (Built-in)' : ''}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="button-row" style={{ marginTop: '10px' }}>
                <button className="button primary" disabled={busy || (!createForm.email.trim() && !createForm.phone.trim())}>
                  <><Icon name="check" size={14} style={{ marginRight: '6px' }} /> Register Staff Member</>
                </button>
                <button className="button secondary" type="button" onClick={() => setShowAddStaff(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STAFF CARDS LIST */}
        {!users.length ? (
          <p className="empty-state">No staff accounts found.</p>
        ) : (
          <div className="staff-cards-grid" style={{ display: 'grid', gap: '14px' }}>
            {users.map((user) => {
              const isSelected = selectedUser?.id === user.id;
              const initials = `${user.firstName?.[0] || 'S'}${user.lastName?.[0] || ''}`;
              return (
                <div key={user.id} style={{ display: 'grid', gap: '10px' }}>
                  <article
                    className="staff-member-card"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '16px 20px',
                      background: isSelected ? 'var(--color-bg-subtle)' : 'var(--color-bg-elevated)',
                      border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-lg)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '50%',
                          background: 'color-mix(in srgb, var(--color-primary) 15%, var(--color-bg-elevated))',
                          color: 'var(--color-primary)',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: '16px',
                        }}
                      >
                        {initials}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h3 style={{ margin: 0, fontSize: '15px' }}>
                            {[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Staff Member'}
                          </h3>
                          <span className={`status ${user.status.toLowerCase()}`}>{user.status}</span>
                        </div>
                        <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                          {user.email || user.phone || 'No direct contact'}
                        </p>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                          {user.userRoles.map(({ role }) => (
                            <span
                              key={role.id}
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '4px',
                                background: 'var(--color-bg-subtle)',
                                border: '1px solid var(--color-border)',
                              }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Icon name="shield" size={12} /> {role.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      {can('users', 'edit') && (
                        <button
                          type="button"
                          className={`button ${isSelected ? 'primary' : 'secondary'} small`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedUser(null);
                            } else {
                              setSelectedUser(user);
                              setEditStatus(user.status);
                              setEditRoles(user.userRoles.map(({ role }) => role.id));
                              setEditProfile({
                                firstName: user.firstName ?? '',
                                lastName: user.lastName ?? '',
                                email: user.email ?? '',
                                phone: user.phone ?? '',
                              });
                              setResetPassword('');
                              setShowAddStaff(false);
                            }
                          }}
                        >
                          {isSelected ? <><Icon name="close" size={14} style={{ marginRight: '6px' }} /> Close</> : <><Icon name="edit" size={14} style={{ marginRight: '6px' }} /> Edit / Manage</>}
                        </button>
                      )}
                    </div>
                  </article>

                  {/* INLINE EDIT FORM FOR THIS USER */}
                  {isSelected && (
                    <div
                      className="tenant-user-editor inline-edit-form"
                      style={{
                        padding: '20px',
                        background: 'var(--color-bg-subtle)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--color-border)',
                        marginBottom: '10px',
                      }}
                    >
                      <div className="panel-heading" style={{ marginBottom: '16px' }}>
                        <div>
                          <h3 style={{ margin: 0 }}>Edit Staff: {user.firstName} {user.lastName}</h3>
                          <p style={{ margin: '2px 0 0', fontSize: '12px' }}>Update profile, status, or role permissions.</p>
                        </div>
                        <button className="button secondary small" type="button" onClick={() => setSelectedUser(null)}>
                          Close Form
                        </button>
                      </div>

                      <form className="stack-form" onSubmit={(event) => void updateUser(event)}>
                        <div className="form-row">
                          <label>First name
                            <input
                              required
                              minLength={2}
                              maxLength={100}
                              value={editProfile.firstName}
                              onChange={(event) => setEditProfile({ ...editProfile, firstName: event.target.value })}
                            />
                          </label>
                          <label>Last name
                            <input
                              required
                              minLength={2}
                              maxLength={100}
                              value={editProfile.lastName}
                              onChange={(event) => setEditProfile({ ...editProfile, lastName: event.target.value })}
                            />
                          </label>
                        </div>

                        <div className="form-row">
                          <label>Email
                            <input
                              type="email"
                              maxLength={254}
                              value={editProfile.email}
                              onChange={(event) => setEditProfile({ ...editProfile, email: event.target.value })}
                            />
                          </label>
                          <label>Phone
                            <input
                              type="tel"
                              value={editProfile.phone}
                              onChange={(event) => setEditProfile({ ...editProfile, phone: event.target.value })}
                            />
                          </label>
                        </div>

                        <label>Account Status
                          <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as User['status'])}>
                            <option value="ACTIVE">Active (Can log in)</option>
                            <option value="DEACTIVATED">Deactivated (Access Revoked)</option>
                          </select>
                        </label>

                        <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
                          <legend style={{ fontWeight: 700, fontSize: '13px', padding: '0 6px' }}>Assigned Roles</legend>
                          <div className="permission-check-grid">
                            {roles.map((role) => (
                              <label className="inline-check" key={role.id}>
                                <input
                                  type="checkbox"
                                  checked={editRoles.includes(role.id)}
                                  onChange={() => toggle(editRoles, role.id, setEditRoles)}
                                />
                                <span>{role.name}{role.isSystemRole ? ' (Built-in)' : ''}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        <div className="button-row" style={{ marginTop: '10px' }}>
                          <button className="button primary" disabled={busy || !editRoles.length}>
                            Save Changes
                          </button>
                          <button className="button secondary" type="button" onClick={() => setSelectedUser(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>

                      {can('users', 'edit') && (
                        <form className="stack-form" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }} onSubmit={(event) => void changeStaffPassword(event)}>
                          <h4 style={{ margin: 0 }}>Reset Staff Password</h4>
                          <label>New temporary password
                            <input
                              required
                              type="password"
                              minLength={12}
                              maxLength={128}
                              pattern={strongPasswordPattern}
                              autoComplete="new-password"
                              value={resetPassword}
                              placeholder="Min 12 characters with upper, lower, number, special"
                              onChange={(event) => setResetPassword(event.target.value)}
                            />
                          </label>
                          <div>
                            <button className="button secondary" disabled={busy || !resetPassword}>
                              Reset Password &amp; Revoke Active Sessions
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ROLES AND PERMISSIONS SECTION */}
      {can('roles', 'view') && (
        <section className="panel roles-management-section">
          <div className="panel-heading">
            <div>
              <h2>Tenant Roles &amp; Permissions</h2>
              <p>Define role capabilities and security profiles across hostel operations.</p>
            </div>
            {can('roles', 'create') && (
              <button
                type="button"
                className="button primary small"
                onClick={() => {
                  chooseRole();
                  // scroll into view
                }}
              >
                + Create New Role
              </button>
            )}
          </div>

          <div className="record-actions" style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {roles.map((role) => (
              <button
                key={role.id}
                type="button"
                className={`button ${role.id === roleId ? 'primary' : 'secondary'} small`}
                onClick={() => chooseRole(role)}
              >
                <Icon name={role.isSystemRole ? "lock" : "shield"} size={13} style={{ marginRight: '6px' }} />
                {role.name}
              </button>
            ))}
          </div>

          {(can('roles', 'create') || (roleId && can('roles', 'edit'))) && (
            <div style={{ padding: '20px', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
              <div className="panel-heading" style={{ marginBottom: '14px' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{roleId ? `Edit Role: ${roleName}` : 'Create Custom Role'}</h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px' }}>Configure access boundaries for this role.</p>
                </div>
              </div>
              <form className="stack-form" onSubmit={(event) => void saveRole(event)}>
                <div className="form-row">
                  <label>Role name
                    <input
                      required
                      minLength={2}
                      maxLength={80}
                      value={roleName}
                      placeholder="e.g. Assistant Warden"
                      onChange={(event) => setRoleName(event.target.value)}
                    />
                  </label>
                  <label>Description
                    <input
                      maxLength={300}
                      value={roleDescription}
                      placeholder="Brief description of responsibilities"
                      onChange={(event) => setRoleDescription(event.target.value)}
                    />
                  </label>
                </div>
                <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
                  <legend style={{ fontWeight: 700, fontSize: '13px', padding: '0 6px' }}>Permissions</legend>
                  <div className="permission-check-grid">
                    {permissions.map((permission) => (
                      <label className="inline-check" key={permission.id}>
                        <input
                          type="checkbox"
                          checked={rolePermissions.includes(permission.id)}
                          onChange={() => toggle(rolePermissions, permission.id, setRolePermissions)}
                        />
                        <span>{permission.module}.{permission.action}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="button-row">
                  <button className="button primary" disabled={busy || !roleName.trim()}>
                    {roleId ? 'Save Role Changes' : 'Create Role'}
                  </button>
                  {roleId && can('roles', 'delete') && (
                    <button className="button danger" type="button" disabled={busy} onClick={() => void deleteRole()}>
                      Delete Role
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}
        </section>
      )}
    </div>
  );
}