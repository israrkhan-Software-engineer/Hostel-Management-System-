'use client';

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
  const [busy, setBusy] = useState(false);

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
    }
    if (subscriptionSummary) setSubscription(subscriptionSummary);
  }, [request]);

  useEffect(() => { void load(); }, [load]);
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
    <div className="tenant-management">
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}
      {subscription && (
        <section className="panel subscription-summary">
          <h2>{subscription.subscription?.plan.name ?? 'No subscription'} · {subscription.subscription?.status ?? 'EXPIRED'}</h2>
          {subscription.subscription && (
            <p>Access through {new Date(subscription.subscription.trialEndsAt ?? subscription.subscription.periodEndsAt).toLocaleDateString()}</p>
          )}
          <p>{subscription.usage.activeUsers} / {subscription.usage.userLimit} active users · {subscription.usage.branches} / {subscription.usage.branchLimit} branches</p>
          {subscription.usage.activeUsers >= subscription.usage.userLimit
            || subscription.usage.branches >= subscription.usage.branchLimit
            ? <p className="notice error">A plan limit has been reached. Contact the platform administrator to upgrade.</p>
            : null}
        </section>
      )}
      <div className="content-grid">
        <section className="panel grow">
          <div className="panel-heading"><div><h2>Staff accounts</h2><p>{users.length} accounts · active-user limits follow your plan.</p></div></div>
          {!users.length ? <p className="empty-state">No staff accounts found.</p> : (
            <div className="record-list">
              {users.map((user) => (
                <article className="record" key={user.id}>
                  <div className="record-main">
                    <div><h3>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Staff member'}</h3>
                      <p>{user.email ?? user.phone ?? 'No contact'} · {user.userRoles.map(({ role }) => role.name).join(', ') || 'No role'}</p></div>
                    <span className={`status ${user.status.toLowerCase()}`}>{user.status}</span>
                  </div>
                  {can('users', 'edit') && <button type="button" className="button secondary small" onClick={() => {
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
                  }}>Manage</button>}
                </article>
              ))}
            </div>
          )}
          {selectedUser && (
            <div className="tenant-user-editor">
              <form className="stack-form" onSubmit={(event) => void updateUser(event)}>
                <h3>Manage {selectedUser.email ?? selectedUser.phone ?? 'staff account'}</h3>
                <label>First name<input required minLength={2} maxLength={100} value={editProfile.firstName}
                  onChange={(event) => setEditProfile({ ...editProfile, firstName: event.target.value })} /></label>
                <label>Last name<input required minLength={2} maxLength={100} value={editProfile.lastName}
                  onChange={(event) => setEditProfile({ ...editProfile, lastName: event.target.value })} /></label>
                <label>Email<input type="email" maxLength={254} value={editProfile.email}
                  onChange={(event) => setEditProfile({ ...editProfile, email: event.target.value })} /></label>
                <label>Phone<input type="tel" value={editProfile.phone}
                  onChange={(event) => setEditProfile({ ...editProfile, phone: event.target.value })} /></label>
                <label>Status<select value={editStatus} onChange={(event) => setEditStatus(event.target.value as User['status'])}>
                  <option value="ACTIVE">Active</option><option value="DEACTIVATED">Deactivated</option>
                </select></label>
                <fieldset><legend>Assigned roles</legend>
                  {roles.map((role) => (
                    <label className="inline-check" key={role.id}>
                      <input type="checkbox" checked={editRoles.includes(role.id)}
                        onChange={() => toggle(editRoles, role.id, setEditRoles)} />
                      {role.name}{role.isSystemRole ? ' · built-in' : ''}
                    </label>
                  ))}
                </fieldset>
                <div className="record-actions">
                  <button className="button primary" disabled={busy || !editRoles.length}>Save access</button>
                  <button className="button secondary" type="button" onClick={() => setSelectedUser(null)}>Close</button>
                </div>
              </form>
              {can('users', 'edit') && <form className="stack-form" onSubmit={(event) => void changeStaffPassword(event)}>
                <h3>Reset staff password</h3>
                <label>Temporary password<input required type="password" minLength={12} maxLength={128}
                  pattern={strongPasswordPattern} autoComplete="new-password" value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)} /></label>
                <button className="button secondary" disabled={busy}>Reset password and revoke sessions</button>
              </form>}
            </div>
          )}
        </section>

        {can('users', 'create') && <section className="panel">
          <h2>Create staff account</h2>
          <form className="stack-form" onSubmit={(event) => void createUser(event)}>
            <label>First name<input required minLength={2} maxLength={100} value={createForm.firstName}
              onChange={(event) => setCreateForm({ ...createForm, firstName: event.target.value })} /></label>
            <label>Last name<input required minLength={2} maxLength={100} value={createForm.lastName}
              onChange={(event) => setCreateForm({ ...createForm, lastName: event.target.value })} /></label>
            <label>Email<input type="email" maxLength={254} value={createForm.email}
              onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} /></label>
            <label>Phone<input type="tel" value={createForm.phone}
              onChange={(event) => setCreateForm({ ...createForm, phone: event.target.value })} /></label>
            <label>Temporary password<input required type="password" minLength={12} maxLength={128}
              pattern={strongPasswordPattern} autoComplete="new-password" value={createForm.temporaryPassword}
              onChange={(event) => setCreateForm({ ...createForm, temporaryPassword: event.target.value })} /></label>
            <fieldset><legend>Initial roles</legend>
              {roles.map((role) => (
                <label className="inline-check" key={role.id}>
                  <input type="checkbox" checked={createRoles.includes(role.id)}
                    onChange={() => toggle(createRoles, role.id, setCreateRoles)} />
                  {role.name}
                </label>
              ))}
            </fieldset>
            <button className="button primary" disabled={busy || !createRoles.length}>Create staff account</button>
          </form>
        </section>}
      </div>

      {can('roles', 'view') && <section className="panel">
        <div className="panel-heading"><div><h2>Tenant roles and permissions</h2><p>Custom roles can only receive permissions you already hold.</p></div>
          {can('roles', 'create') && <button type="button" className="button secondary small" onClick={() => chooseRole()}>New role</button>}
        </div>
        <div className="record-actions">
          {roles.filter(({ isSystemRole }) => !isSystemRole).map((role) => (
            <button key={role.id} type="button" className={`button ${role.id === roleId ? 'primary' : 'secondary'} small`}
              onClick={() => chooseRole(role)}>{role.name}</button>
          ))}
        </div>
        {(can('roles', 'create') || (roleId && can('roles', 'edit'))) && <form className="stack-form" onSubmit={(event) => void saveRole(event)}>
          <label>Role name<input required minLength={2} maxLength={80} value={roleName}
            onChange={(event) => setRoleName(event.target.value)} /></label>
          <label>Description<input maxLength={300} value={roleDescription}
            onChange={(event) => setRoleDescription(event.target.value)} /></label>
          <fieldset><legend>Permissions</legend>
            <div className="permission-check-grid">
              {permissions.map((permission) => (
                <label className="inline-check" key={permission.id}>
                  <input type="checkbox" checked={rolePermissions.includes(permission.id)}
                    onChange={() => toggle(rolePermissions, permission.id, setRolePermissions)} />
                  {permission.module}.{permission.action}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="record-actions">
            <button className="button primary" disabled={busy}>{roleId ? 'Save role' : 'Create role'}</button>
            {roleId && can('roles', 'delete') && <button className="button danger" type="button" disabled={busy} onClick={() => void deleteRole()}>Delete role</button>}
          </div>
        </form>}
      </section>}
    </div>
  );
}
