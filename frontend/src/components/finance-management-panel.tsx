'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api/client';

type ResidentOption = { id: string; firstName: string; lastName: string; status: string };
type FeeStructure = {
  id: string;
  name: string;
  category: string | null;
  interval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  amountMinor: number;
  isActive: boolean;
  assignments: { id: string; residentId: string; startsAt: string; endsAt: string | null }[];
};
type Discount = {
  id: string;
  residentId: string;
  type: 'FIXED' | 'PERCENTAGE' | 'SCHOLARSHIP';
  value: number;
  reason: string;
  approvedAt: string | null;
  resident: { firstName: string; lastName: string };
};
type LateFeeSetting = {
  id: string;
  daysAfterDue: number;
  feeType: 'FIXED' | 'PERCENTAGE';
  amount: number;
  isActive: boolean;
};
type LateFeeRecord = { id: string; invoiceId: string; amountMinor: number; appliedAt: string };
type DepositRecord = { id: string; type: 'DEPOSIT' | 'ADJUSTMENT' | 'REFUND'; amountMinor: number; notes: string | null; createdAt: string };

function minorUnits(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export default function FinanceManagementPanel({
  branchId,
  residents,
  can,
}: {
  branchId: string;
  residents: ResidentOption[];
  can: (module: string, action: string) => boolean;
}) {
  const [fees, setFees] = useState<FeeStructure[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [lateFees, setLateFees] = useState<LateFeeSetting[]>([]);
  const [lateFeeHistory, setLateFeeHistory] = useState<LateFeeRecord[]>([]);
  const [depositBalance, setDepositBalance] = useState<number | null>(null);
  const [depositHistory, setDepositHistory] = useState<DepositRecord[]>([]);
  const [myDeposit, setMyDeposit] = useState<{ balanceMinor: number; transactions: DepositRecord[] } | null>(null);
  const [residentId, setResidentId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [feesResult, discountsResult, lateFeesResult, lateHistoryResult] = await Promise.all([
      apiRequest<FeeStructure[]>(`/branches/${branchId}/fee-structures`),
      apiRequest<Discount[]>(`/branches/${branchId}/discounts`),
      apiRequest<LateFeeSetting[]>(`/branches/${branchId}/late-fee-settings`),
      apiRequest<LateFeeRecord[]>(`/branches/${branchId}/late-fee-history`),
    ]);
    const failed = [feesResult, discountsResult, lateFeesResult, lateHistoryResult].find((item) => !item.ok);
    if (failed && !failed.ok) {
      setError(failed.message);
      return;
    }
    if (feesResult.ok && discountsResult.ok && lateFeesResult.ok && lateHistoryResult.ok) {
      setFees(feesResult.data);
      setDiscounts(discountsResult.data);
      setLateFees(lateFeesResult.data);
      setLateFeeHistory(lateHistoryResult.data);
      setError('');
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!can('payments', 'view') || can('payments', 'approve')) {
      setMyDeposit(null);
      return;
    }
    let active = true;
    void apiRequest<{ balanceMinor: number; transactions: DepositRecord[] }>(
      `/branches/${branchId}/resident/security-deposit`,
    ).then((result) => {
      if (active && result.ok) setMyDeposit(result.data);
      if (active && !result.ok && result.status !== 404) setError(result.message);
    });
    return () => { active = false; };
  }, [branchId, can]);

  async function submit<T>(event: FormEvent<HTMLFormElement>, path: string, value: unknown, success: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    setFeedback('');
    const result = await apiRequest<T>(path, { method: 'POST', body: JSON.stringify(value) });
    if (!result.ok) setError(result.message);
    else {
      setFeedback(success);
      form.reset();
      await load();
    }
    setBusy(false);
  }

  async function runAction(path: string, method: 'POST' | 'PATCH', success: string, value?: unknown) {
    setBusy(true);
    const result = await apiRequest<unknown>(path, {
      method,
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    if (!result.ok) setError(result.message);
    else {
      setFeedback(success);
      await load();
    }
    setBusy(false);
  }

  const activeResidents = residents.filter((resident) => resident.status === 'ACTIVE');
  const selectedResident = residentId || activeResidents[0]?.id || '';

  return (
    <section className="panel finance-management">
      <div className="panel-heading">
        <div><h2>Fees, discounts and deposits</h2><p>Configure recurring fees, late charges, approved student discounts and deposit ledger entries.</p></div>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {feedback && <p className="notice success" role="status">{feedback}</p>}
      {myDeposit && (
        <section className="subpanel">
          <h3>My security deposit</h3>
          <p>Current balance: <strong>{myDeposit.balanceMinor.toLocaleString()} minor units</strong></p>
          <ul className="compact-record-list">{myDeposit.transactions.map((transaction) => (
            <li key={transaction.id}>{transaction.type} · {transaction.amountMinor.toLocaleString()} minor units · {new Date(transaction.createdAt).toLocaleDateString()}</li>
          ))}</ul>
        </section>
      )}

      {can('invoices', 'manage_settings') && (
        <div className="finance-management-grid">
          <section className="subpanel">
            <h3>Fee structures</h3>
            <form className="stack-form" onSubmit={(event) => {
              const data = new FormData(event.currentTarget);
              void submit(event, `/branches/${branchId}/fee-structures`, {
                name: String(data.get('name') ?? ''),
                category: String(data.get('category') ?? '') || undefined,
                interval: String(data.get('interval') ?? 'MONTHLY'),
                amountMinor: minorUnits(String(data.get('amount') ?? '0')),
              }, 'Fee structure created.');
            }}>
              <label>Name<input name="name" required maxLength={120} /></label>
              <label>Room/category (optional)<input name="category" maxLength={80} /></label>
              <label>Billing interval<select name="interval"><option>MONTHLY</option><option>QUARTERLY</option><option>YEARLY</option></select></label>
              <label>Amount<input name="amount" required type="number" min="0.01" step="0.01" /></label>
              <button className="button primary" disabled={busy}>Create fee structure</button>
            </form>
            <ul className="compact-record-list">
              {fees.map((fee) => (
                <li key={fee.id}>
                  <strong>{fee.name}</strong> · {fee.category || 'General'} · {fee.interval} · {fee.amountMinor.toLocaleString()} minor units
                  {fee.isActive && can('invoices', 'manage_settings') && (
                    <button className="button secondary small" type="button" disabled={busy} onClick={() => void runAction(
                      `/branches/${branchId}/fee-structures/${fee.id}/deactivate`,
                      'PATCH',
                      'Fee structure deactivated.',
                    )}>Deactivate</button>
                  )}
                  <form className="inline-form" onSubmit={(event) => {
                    const data = new FormData(event.currentTarget);
                    void submit(event, `/branches/${branchId}/fee-structures/${fee.id}/assignments`, {
                      residentId: String(data.get('residentId') ?? ''),
                      startsAt: String(data.get('startsAt') ?? ''),
                    }, 'Fee assigned; assignment history is retained.');
                  }}>
                    <select name="residentId" required defaultValue=""><option value="" disabled>Assign resident</option>
                      {activeResidents.map((resident) => <option key={resident.id} value={resident.id}>{resident.firstName} {resident.lastName}</option>)}
                    </select>
                    <input name="startsAt" aria-label="Fee start date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
                    <button className="button secondary small" disabled={busy || !fee.isActive}>Assign</button>
                  </form>
                  {fee.assignments.slice(0, 3).map((assignment) => (
                    <button key={assignment.id} className="button secondary small" type="button" disabled={busy} onClick={() => void runAction(
                      `/branches/${branchId}/fee-assignments/${assignment.id}/invoices`,
                      'POST',
                      'Invoice generated from the assigned fee.',
                      {},
                    )}>Generate invoice</button>
                  ))}
                </li>
              ))}
            </ul>
          </section>

          <section className="subpanel">
            <h3>Late fees</h3>
            <form className="stack-form" onSubmit={(event) => {
              const data = new FormData(event.currentTarget);
              const feeType = String(data.get('feeType'));
              const amountText = String(data.get('amount') ?? '0');
              void submit(event, `/branches/${branchId}/late-fee-settings`, {
                daysAfterDue: Number(data.get('daysAfterDue')),
                feeType,
                amount: feeType === 'FIXED' ? minorUnits(amountText) : Math.round(Number(amountText) * 100),
              }, 'Late fee rule saved and daily processing scheduled.');
            }}>
              <label>Apply after days overdue<input name="daysAfterDue" required type="number" min="1" max="365" /></label>
              <label>Fee type<select name="feeType"><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">Percentage</option></select></label>
              <label>Fixed amount or percentage<input name="amount" required type="number" min="0.01" step="0.01" /></label>
              <button className="button primary" disabled={busy}>Save late fee rule</button>
            </form>
            <button className="button secondary" type="button" disabled={busy} onClick={() => void runAction(
              `/branches/${branchId}/late-fees/apply`,
              'POST',
              'Applicable late fees have been applied.',
            )}>Apply overdue fees now</button>
            <ul className="compact-record-list">{lateFees.map((rule) => (
              <li key={rule.id}>
                {rule.daysAfterDue} days overdue · {rule.feeType === 'FIXED' ? `${rule.amount} minor units` : `${rule.amount / 100}%`} · {rule.isActive ? 'Active' : 'Inactive'}
                {rule.isActive && <button className="button secondary small" type="button" disabled={busy} onClick={() => void runAction(
                  `/branches/${branchId}/late-fee-settings/${rule.id}/deactivate`,
                  'PATCH',
                  'Late fee rule deactivated.',
                )}>Deactivate</button>}
              </li>
            ))}</ul>
            <h4>Recent late-fee history</h4>
            <ul className="compact-record-list">{lateFeeHistory.slice(0, 10).map((record) => (
              <li key={record.id}>Invoice {record.invoiceId} · {record.amountMinor} minor units · {new Date(record.appliedAt).toLocaleDateString()}</li>
            ))}</ul>
          </section>
        </div>
      )}

      <div className="finance-management-grid">
        {can('invoices', 'create') && (
          <section className="subpanel">
            <h3>Student discounts</h3>
            <form className="stack-form" onSubmit={(event) => {
              const data = new FormData(event.currentTarget);
              const type = String(data.get('type'));
              const rawValue = String(data.get('value') ?? '0');
              void submit(event, `/branches/${branchId}/discounts`, {
                residentId: String(data.get('residentId') ?? ''),
                type,
                value: type === 'PERCENTAGE' ? Math.round(Number(rawValue) * 100) : minorUnits(rawValue),
                reason: String(data.get('reason') ?? ''),
                startsAt: String(data.get('startsAt') ?? ''),
                ...(String(data.get('endsAt') ?? '') ? { endsAt: String(data.get('endsAt')) } : {}),
              }, 'Discount submitted for approval.');
            }}>
              <label>Resident<select name="residentId" required defaultValue=""><option value="" disabled>Select resident</option>
                {activeResidents.map((resident) => <option key={resident.id} value={resident.id}>{resident.firstName} {resident.lastName}</option>)}
              </select></label>
              <label>Discount type<select name="type"><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">Percentage</option><option value="SCHOLARSHIP">Scholarship amount</option></select></label>
              <label>Amount or percentage<input name="value" required type="number" min="0.01" step="0.01" /></label>
              <label>Reason<input name="reason" required maxLength={500} /></label>
              <label>Starts<input name="startsAt" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label>Ends (optional)<input name="endsAt" type="date" /></label>
              <button className="button primary" disabled={busy}>Submit discount</button>
            </form>
            <ul className="compact-record-list">{discounts.map((discount) => (
              <li key={discount.id}>
                {discount.resident.firstName} {discount.resident.lastName} · {discount.type} · {discount.value} · {discount.approvedAt ? 'Approved' : 'Pending'}
                {!discount.approvedAt && can('invoices', 'approve') && (
                  <button className="button secondary small" type="button" disabled={busy} onClick={() => void runAction(
                    `/branches/${branchId}/discounts/${discount.id}/approve`,
                    'PATCH',
                    'Discount approved.',
                  )}>Approve</button>
                )}
              </li>
            ))}</ul>
          </section>
        )}

        {can('payments', 'approve') && (
          <section className="subpanel">
            <h3>Security deposit ledger</h3>
            <form className="stack-form" onSubmit={(event) => {
              const data = new FormData(event.currentTarget);
              const type = String(data.get('type'));
              const raw = Number(data.get('amount'));
              void submit(event, `/branches/${branchId}/security-deposits/transactions`, {
                residentId: String(data.get('residentId') ?? ''),
                type,
                amountMinor: Math.round(raw * 100),
                submissionKey: crypto.randomUUID(),
                ...(String(data.get('notes') ?? '') ? { notes: String(data.get('notes')) } : {}),
              }, 'Security deposit transaction recorded.');
            }}>
              <label>Resident<select required value={selectedResident} onChange={(event) => setResidentId(event.target.value)} name="residentId">
                <option value="" disabled>Select resident</option>
                {activeResidents.map((resident) => <option key={resident.id} value={resident.id}>{resident.firstName} {resident.lastName}</option>)}
              </select></label>
              <label>Transaction<select name="type"><option value="DEPOSIT">Deposit</option><option value="ADJUSTMENT">Adjustment</option><option value="REFUND">Refund</option></select></label>
              <label>Amount (negative adjustment reduces balance)<input name="amount" required type="number" step="0.01" /></label>
              <label>Notes<input name="notes" maxLength={1000} /></label>
              <button className="button primary" disabled={busy || !selectedResident}>Record transaction</button>
            </form>
            {selectedResident && (
              <button className="button secondary small" type="button" disabled={busy} onClick={async () => {
                const result = await apiRequest<{ balanceMinor: number; transactions: DepositRecord[] }>(`/branches/${branchId}/residents/${selectedResident}/security-deposit`);
                if (!result.ok) setError(result.message);
                else {
                  setDepositBalance(result.data.balanceMinor);
                  setDepositHistory(result.data.transactions);
                  setFeedback(`Current deposit balance: ${result.data.balanceMinor.toLocaleString()} minor units.`);
                }
              }}>Refresh deposit balance</button>
            )}
            {depositBalance !== null && <p>Balance: <strong>{depositBalance.toLocaleString()} minor units</strong></p>}
            <ul className="compact-record-list">{depositHistory.map((transaction) => (
              <li key={transaction.id}>{transaction.type} · {transaction.amountMinor.toLocaleString()} minor units · {new Date(transaction.createdAt).toLocaleDateString()}{transaction.notes ? ` · ${transaction.notes}` : ''}</li>
            ))}</ul>
          </section>
        )}
      </div>
    </section>
  );
}
