'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api/client';
import Icon from './ui/icon';

type DepositRecord = {
  id: string;
  type: string;
  amountMinor: number;
  notes: string | null;
  createdAt: string;
};

type FeeStructure = {
  id: string;
  name: string;
  category: string | null;
  interval: string;
  amountMinor: number;
  isActive: boolean;
  assignments: { id: string; startsAt: string; resident: { firstName: string; lastName: string } }[];
};

type LateFeeRule = {
  id: string;
  daysAfterDue: number;
  feeType: 'FIXED' | 'PERCENTAGE';
  amount: number;
  isActive: boolean;
};

type Discount = {
  id: string;
  type: string;
  value: number;
  reason: string;
  approvedAt: string | null;
  resident: { firstName: string; lastName: string };
};

type ResidentOption = { id: string; firstName: string; lastName: string; status: string };

type FinanceManagementPanelProps = {
  branchId: string;
  residents: ResidentOption[];
  can: (module: string, action: string) => boolean;
};

export default function FinanceManagementPanel({ branchId, residents, can }: FinanceManagementPanelProps) {
  const [fees, setFees] = useState<FeeStructure[]>([]);
  const [lateFees, setLateFees] = useState<LateFeeRule[]>([]);
  const [lateFeeHistory, setLateFeeHistory] = useState<{ id: string; invoiceId: string; amountMinor: number; appliedAt: string }[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [depositBalance, setDepositBalance] = useState<number | null>(null);
  const [depositTransactions, setDepositTransactions] = useState<DepositRecord[]>([]);
  const [selectedResident, setResidentId] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const activeResidents = residents.filter((r) => r.status === 'ACTIVE');

  const minorUnits = (val: string) => Math.round(Number(val) * 100);

  const loadSettings = useCallback(async () => {
    if (!branchId) return;
    setError('');
    const [feeRes, lateRes, discRes] = await Promise.all([
      can('invoices', 'manage_settings') ? apiRequest<FeeStructure[]>(`/branches/${branchId}/fee-structures`) : null,
      can('invoices', 'manage_settings') ? apiRequest<LateFeeRule[]>(`/branches/${branchId}/late-fee-settings`) : null,
      can('invoices', 'create') ? apiRequest<Discount[]>(`/branches/${branchId}/discounts`) : null,
    ]);

    if (feeRes && feeRes.ok) setFees(feeRes.data);
    if (lateRes && lateRes.ok) setLateFees(lateRes.data);
    if (discRes && discRes.ok) setDiscounts(discRes.data);

    if (can('invoices', 'manage_settings')) {
      const hist = await apiRequest<{ id: string; invoiceId: string; amountMinor: number; appliedAt: string }[]>(
        `/branches/${branchId}/late-fee-history`,
      );
      if (hist.ok) setLateFeeHistory(hist.data);
    }
  }, [branchId, can]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 9000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 7000);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function submit(
    event: FormEvent<HTMLFormElement>,
    url: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    event.preventDefault();
    setError('');
    setFeedback('');
    setBusy(true);
    const form = event.currentTarget;
    const res = await apiRequest(url, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
    } else {
      setFeedback(successMessage);
      form.reset();
      await loadSettings();
    }
  }

  async function runAction(url: string, method: 'PATCH' | 'POST', msg: string, body?: Record<string, unknown>) {
    setError('');
    setFeedback('');
    setBusy(true);
    const res = await apiRequest(url, { method, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
    } else {
      setFeedback(msg);
      await loadSettings();
    }
  }

  return (
    <div className="finance-management-wrapper" style={{ marginTop: '24px', display: 'grid', gap: '24px' }}>
      {error && (
        <div className="notice error" role="alert">
          <Icon name="alert" size={18} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="notice-close" onClick={() => setError('')} aria-label="Dismiss error">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {feedback && (
        <div className="notice success" role="status">
          <Icon name="checkCircle" size={18} />
          <span style={{ flex: 1 }}>{feedback}</span>
          <button type="button" className="notice-close" onClick={() => setFeedback('')} aria-label="Dismiss message">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {depositBalance !== null && (
        <section className="panel subpanel">
          <div className="panel-heading">
            <div>
              <h3>My security deposit</h3>
              <p>Current balance and recent transactions.</p>
            </div>
            <strong className="mono" style={{ fontSize: '18px' }}>
              {(depositBalance / 100).toFixed(2)} units
            </strong>
          </div>
          <ul className="compact-record-list">
            {depositTransactions.map((transaction) => (
              <li key={transaction.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span>{transaction.type}</span> · <strong>{(transaction.amountMinor / 100).toFixed(2)}</strong> · <small>{new Date(transaction.createdAt).toLocaleDateString()}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 12. FEE STRUCTURE: Clean layout & proper form alignment */}
      {can('invoices', 'manage_settings') && (
        <div className="finance-management-grid">
          <section className="panel subpanel fee-structures-panel">
            <div className="panel-heading">
              <div>
                <h2>Fee Structures</h2>
                <p>Define standard recurring fees and assign them to active residents.</p>
              </div>
            </div>

            {/* Create Fee Structure Form */}
            <form
              className="stack-form fee-structure-form"
              onSubmit={(event) => {
                const data = new FormData(event.currentTarget);
                void submit(
                  event,
                  `/branches/${branchId}/fee-structures`,
                  {
                    name: String(data.get('name') ?? ''),
                    category: String(data.get('category') ?? '') || undefined,
                    interval: String(data.get('interval') ?? 'MONTHLY'),
                    amountMinor: minorUnits(String(data.get('amount') ?? '0')),
                  },
                  'Fee structure created.',
                );
              }}
            >
              <div className="form-row">
                <label>
                  Structure Name
                  <input name="name" required maxLength={120} placeholder="e.g. Standard Room Rent" />
                </label>
                <label>
                  Room / Category (optional)
                  <input name="category" maxLength={80} placeholder="e.g. Double Occupancy" />
                </label>
              </div>

              <div className="form-row">
                <label>
                  Billing Interval
                  <select name="interval" defaultValue="MONTHLY">
                    <option value="MONTHLY">MONTHLY</option>
                    <option value="QUARTERLY">QUARTERLY</option>
                    <option value="YEARLY">YEARLY</option>
                  </select>
                </label>
                <label>
                  Amount
                  <input name="amount" required type="number" min="0.01" step="0.01" placeholder="0.00" />
                </label>
              </div>

              <div>
                <button className="button primary" disabled={busy}>
                  <Icon name="plus" size={14} /> Create fee structure
                </button>
              </div>
            </form>

            {/* Existing Fee Structures List */}
            <div className="fee-structures-list" style={{ marginTop: '24px' }}>
              <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>Active Fee Structures ({fees.length})</h3>
              {!fees.length ? (
                <p className="empty-state">No fee structures configured yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: '14px' }}>
                  {fees.map((fee) => (
                    <article
                      key={fee.id}
                      className="fee-structure-card"
                      style={{
                        padding: '16px',
                        background: 'var(--color-bg-subtle)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                        <div>
                          <strong style={{ fontSize: '16px' }}>{fee.name}</strong>
                          <span style={{ marginLeft: '8px', fontSize: '12px', padding: '2px 8px', borderRadius: '4px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }}>
                            {fee.category || 'General'}
                          </span>
                          <span style={{ marginLeft: '6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                            · {fee.interval}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span className="mono" style={{ fontWeight: 800, fontSize: '16px' }}>
                            {(fee.amountMinor / 100).toFixed(2)}
                          </span>
                          {fee.isActive && can('invoices', 'manage_settings') && (
                            <button
                              className="button secondary small"
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(
                                  `/branches/${branchId}/fee-structures/${fee.id}/deactivate`,
                                  'PATCH',
                                  'Fee structure deactivated.',
                                )
                              }
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Assignment Form */}
                      <form
                        className="inline-form"
                        style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap', paddingTop: '12px', borderTop: '1px dashed var(--color-border)' }}
                        onSubmit={(event) => {
                          const data = new FormData(event.currentTarget);
                          void submit(
                            event,
                            `/branches/${branchId}/fee-structures/${fee.id}/assignments`,
                            {
                              residentId: String(data.get('residentId') ?? ''),
                              startsAt: String(data.get('startsAt') ?? ''),
                            },
                            'Fee assigned; assignment history is retained.',
                          );
                        }}
                      >
                        <label style={{ flex: '2', minWidth: '160px' }}>
                          Assign to resident
                          <select name="residentId" required defaultValue="">
                            <option value="" disabled>Select active resident</option>
                            {activeResidents.map((resident) => (
                              <option key={resident.id} value={resident.id}>
                                {resident.firstName} {resident.lastName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ flex: '1', minWidth: '130px' }}>
                          Start date
                          <input
                            name="startsAt"
                            aria-label="Fee start date"
                            type="date"
                            required
                            defaultValue={new Date().toISOString().slice(0, 10)}
                          />
                        </label>
                        <button className="button secondary small" disabled={busy || !fee.isActive}>
                          Assign
                        </button>
                      </form>

                      {fee.assignments.length > 0 && (
                        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span className="muted" style={{ fontSize: '12px' }}>Assigned:</span>
                          {fee.assignments.slice(0, 3).map((assignment) => (
                            <button
                              key={assignment.id}
                              className="button secondary small"
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(
                                  `/branches/${branchId}/fee-assignments/${assignment.id}/invoices`,
                                  'POST',
                                  'Invoice generated from the assigned fee.',
                                  {},
                                )
                              }
                            >
                              Invoice {assignment.resident?.firstName ?? 'Resident'}
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Late Fees Section */}
          <section className="panel subpanel late-fees-panel">
            <div className="panel-heading">
              <div>
                <h2>Late Fees</h2>
                <p>Automated rules applied to overdue invoices.</p>
              </div>
            </div>

            <form
              className="stack-form"
              onSubmit={(event) => {
                const data = new FormData(event.currentTarget);
                const feeType = String(data.get('feeType'));
                const amountText = String(data.get('amount') ?? '0');
                void submit(
                  event,
                  `/branches/${branchId}/late-fee-settings`,
                  {
                    daysAfterDue: Number(data.get('daysAfterDue')),
                    feeType,
                    amount: feeType === 'FIXED' ? minorUnits(amountText) : Math.round(Number(amountText) * 100),
                  },
                  'Late fee rule saved and daily processing scheduled.',
                );
              }}
            >
              <div className="form-row">
                <label>
                  Apply after days overdue
                  <input name="daysAfterDue" required type="number" min="1" max="365" defaultValue={7} />
                </label>
                <label>
                  Fee type
                  <select name="feeType" defaultValue="FIXED">
                    <option value="FIXED">Fixed amount</option>
                    <option value="PERCENTAGE">Percentage</option>
                  </select>
                </label>
              </div>
              <label>
                Amount or percentage
                <input name="amount" required type="number" min="0.01" step="0.01" placeholder="Amount or %" />
              </label>
              <div className="button-row">
                <button className="button primary" disabled={busy}>Save late fee rule</button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      `/branches/${branchId}/late-fees/apply`,
                      'POST',
                      'Applicable late fees have been applied.',
                    )
                  }
                >
                  Apply overdue fees now
                </button>
              </div>
            </form>

            <ul className="compact-record-list" style={{ marginTop: '16px' }}>
              {lateFees.map((rule) => (
                <li key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span>
                    {rule.daysAfterDue} days overdue ·{' '}
                    <strong>{rule.feeType === 'FIXED' ? `${(rule.amount / 100).toFixed(2)} units` : `${rule.amount / 100}%`}</strong>{' '}
                    · <span className={`status ${rule.isActive ? 'active' : 'neutral'}`}>{rule.isActive ? 'Active' : 'Inactive'}</span>
                  </span>
                  {rule.isActive && (
                    <button
                      className="button secondary small"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runAction(
                          `/branches/${branchId}/late-fee-settings/${rule.id}/deactivate`,
                          'PATCH',
                          'Late fee rule deactivated.',
                        )
                      }
                    >
                      Deactivate
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {lateFeeHistory.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <h4 style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>Recent late-fee history</h4>
                <ul className="compact-record-list">
                  {lateFeeHistory.slice(0, 5).map((record) => (
                    <li key={record.id} style={{ padding: '4px 0', fontSize: '12px' }}>
                      Invoice #{record.invoiceId.slice(0, 8)} · {(record.amountMinor / 100).toFixed(2)} units · {new Date(record.appliedAt).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}

      {/* DISCOUNTS & SECURITY DEPOSIT LEDGER */}
      <div className="finance-management-grid">
        {can('invoices', 'create') && (
          <section className="panel subpanel">
            <div className="panel-heading">
              <div>
                <h2>Student Discounts</h2>
                <p>Submit customized resident discounts for warden/owner review.</p>
              </div>
            </div>
            <form
              className="stack-form"
              onSubmit={(event) => {
                const data = new FormData(event.currentTarget);
                const type = String(data.get('type'));
                const rawValue = String(data.get('value') ?? '0');
                void submit(
                  event,
                  `/branches/${branchId}/discounts`,
                  {
                    residentId: String(data.get('residentId') ?? ''),
                    type,
                    value: type === 'PERCENTAGE' ? Math.round(Number(rawValue) * 100) : minorUnits(rawValue),
                    reason: String(data.get('reason') ?? ''),
                    startsAt: String(data.get('startsAt') ?? ''),
                    ...(String(data.get('endsAt') ?? '') ? { endsAt: String(data.get('endsAt')) } : {}),
                  },
                  'Discount submitted for approval.',
                );
              }}
            >
              <div className="form-row">
                <label>Resident
                  <select name="residentId" required defaultValue="">
                    <option value="" disabled>Select resident</option>
                    {activeResidents.map((resident) => (
                      <option key={resident.id} value={resident.id}>
                        {resident.firstName} {resident.lastName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Discount type
                  <select name="type" defaultValue="FIXED">
                    <option value="FIXED">Fixed amount</option>
                    <option value="PERCENTAGE">Percentage</option>
                    <option value="SCHOLARSHIP">Scholarship amount</option>
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label>Amount or percentage
                  <input name="value" required type="number" min="0.01" step="0.01" placeholder="Amount or %" />
                </label>
                <label>Reason
                  <input name="reason" required maxLength={500} placeholder="e.g. Merit scholarship" />
                </label>
              </div>
              <div className="form-row">
                <label>Starts
                  <input name="startsAt" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                </label>
                <label>Ends (optional)
                  <input name="endsAt" type="date" />
                </label>
              </div>
              <div>
                <button className="button primary" disabled={busy}>Submit discount</button>
              </div>
            </form>
            <ul className="compact-record-list" style={{ marginTop: '16px' }}>
              {discounts.map((discount) => (
                <li key={discount.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span>
                    {discount.resident?.firstName ?? 'Resident'} {discount.resident?.lastName ?? ''} · {discount.type} · {discount.value} ·{' '}
                    <span className={`status ${discount.approvedAt ? 'approved' : 'pending'}`}>
                      {discount.approvedAt ? 'Approved' : 'Pending'}
                    </span>
                  </span>
                  {!discount.approvedAt && can('invoices', 'approve') && (
                    <button
                      className="button secondary small"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runAction(
                          `/branches/${branchId}/discounts/${discount.id}/approve`,
                          'PATCH',
                          'Discount approved.',
                        )
                      }
                    >
                      Approve
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {can('payments', 'approve') && (
          <section className="panel subpanel">
            <div className="panel-heading">
              <div>
                <h2>Security Deposit Ledger</h2>
                <p>Record resident security deposits, adjustments, and refunds.</p>
              </div>
            </div>
            <form
              className="stack-form"
              onSubmit={(event) => {
                const data = new FormData(event.currentTarget);
                const type = String(data.get('type'));
                const raw = Number(data.get('amount'));
                void submit(
                  event,
                  `/branches/${branchId}/security-deposits/transactions`,
                  {
                    residentId: String(data.get('residentId') ?? ''),
                    type,
                    amountMinor: Math.round(raw * 100),
                    submissionKey: crypto.randomUUID(),
                    ...(String(data.get('notes') ?? '') ? { notes: String(data.get('notes')) } : {}),
                  },
                  'Security deposit transaction recorded.',
                );
              }}
            >
              <div className="form-row">
                <label>Resident
                  <select
                    required
                    value={selectedResident}
                    onChange={(event) => setResidentId(event.target.value)}
                    name="residentId"
                  >
                    <option value="" disabled>Select resident</option>
                    {activeResidents.map((resident) => (
                      <option key={resident.id} value={resident.id}>
                        {resident.firstName} {resident.lastName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Transaction
                  <select name="type" defaultValue="DEPOSIT">
                    <option value="DEPOSIT">Deposit</option>
                    <option value="ADJUSTMENT">Adjustment</option>
                    <option value="REFUND">Refund</option>
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label>Amount
                  <input name="amount" required type="number" step="0.01" placeholder="0.00" />
                </label>
                <label>Notes
                  <input name="notes" maxLength={1000} placeholder="Transaction details..." />
                </label>
              </div>
              <div>
                <button className="button primary" disabled={busy}>Record transaction</button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
