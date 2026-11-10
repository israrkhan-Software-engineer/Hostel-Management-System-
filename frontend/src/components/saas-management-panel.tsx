'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api/client';

type Plan = {
  id: string;
  name: string;
  description: string | null;
  monthlyPriceMinor: number;
  yearlyPriceMinor: number;
  currency: string;
  userLimit: number;
  branchLimit: number;
  features: Record<string, boolean>;
  isActive: boolean;
};
type TenantOption = { id: string; name: string; slug: string };
type TenantSubscription = {
  id: string;
  status: string;
  billingInterval: string;
  periodEndsAt: string;
  trialEndsAt: string | null;
  plan: Plan;
  invoices: {
    id: string;
    invoiceNumber: string;
    amountMinor: number;
    currency: string;
    status: string;
    dueAt: string;
    payments: { id: string; amountMinor: number; method: string; reference: string | null; receivedAt: string }[];
  }[];
  history?: { id: string; event: string; details: unknown; createdAt: string }[];
};
type Invoice = {
  id: string;
  invoiceNumber: string;
  description: string;
  amountMinor: number;
  currency: string;
  status: string;
  dueAt: string;
  tenant: TenantOption;
  payments: { id: string; amountMinor: number; method: string; reference: string | null; receivedAt: string }[];
};
type TrialSettings = { durationDays: number; notifyDaysBefore: number; trialPlanId: string };
type Report = {
  subscriptions: { status: string; _count: { _all: number } }[];
  invoices: { status: string; currency: string; _sum: { amountMinor: number | null }; _count: { _all: number } }[];
  trialsExpiring: { id: string; trialEndsAt: string | null; tenant: TenantOption; plan: { name: string } }[];
};
type Paginated<T> = { items: T[] };

const blankPlan = {
  name: '',
  description: '',
  monthlyPriceMinor: 0,
  yearlyPriceMinor: 0,
  currency: 'PKR',
  userLimit: 10,
  branchLimit: 1,
  features: {} as Record<string, boolean>,
  isActive: true,
};

export default function SaasManagementPanel({ refreshKey }: { refreshKey: number }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [trial, setTrial] = useState<TrialSettings | null>(null);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedTenant, setSelectedTenant] = useState('');
  const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
  const [planForm, setPlanForm] = useState(blankPlan);
  const [featuresText, setFeaturesText] = useState('{}');
  const [billingInterval, setBillingInterval] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [invoiceId, setInvoiceId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const call = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T | null> => {
    const response = await apiRequest<T>(path, init);
    if (!response.ok) {
      setError(response.message);
      return null;
    }
    return response.data;
  }, []);

  const refresh = useCallback(async () => {
    const [planRows, tenantRows, invoiceRows, trialSettings, reportData] = await Promise.all([
      call<Plan[]>('/platform/admin/plans'),
      call<Paginated<TenantOption>>('/platform/admin/tenants?page=1&pageSize=100'),
      call<Paginated<Invoice>>('/platform/admin/invoices?page=1&pageSize=100'),
      call<TrialSettings>('/platform/admin/trial-settings'),
      call<Report>('/platform/admin/reports/subscriptions'),
    ]);
    if (planRows) setPlans(planRows);
    if (tenantRows) setTenants(tenantRows.items);
    if (invoiceRows) setInvoices(invoiceRows.items);
    if (trialSettings) setTrial(trialSettings);
    if (reportData) setReport(reportData);
  }, [call]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  useEffect(() => {
    if (!selectedTenant) {
      setSubscription(null);
      return;
    }
    void call<TenantSubscription>(`/platform/admin/tenants/${selectedTenant}/subscription`)
      .then((result) => { if (result) setSubscription(result); });
  }, [call, selectedTenant]);

  function editPlan(plan?: Plan) {
    if (!plan) {
      setSelectedPlan('');
      setPlanForm(blankPlan);
      setFeaturesText('{}');
      return;
    }
    setSelectedPlan(plan.id);
    setPlanForm({
      name: plan.name,
      description: plan.description ?? '',
      monthlyPriceMinor: plan.monthlyPriceMinor,
      yearlyPriceMinor: plan.yearlyPriceMinor,
      currency: plan.currency,
      userLimit: plan.userLimit,
      branchLimit: plan.branchLimit,
      features: plan.features,
      isActive: plan.isActive,
    });
    setFeaturesText(JSON.stringify(plan.features, null, 2));
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    let features: Record<string, boolean>;
    try {
      const parsed: unknown = JSON.parse(featuresText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || Object.values(parsed).some((value) => typeof value !== 'boolean')) {
        throw new Error('Features must be a JSON object with boolean values.');
      }
      features = parsed as Record<string, boolean>;
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Invalid features JSON.');
      return;
    }
    setBusy(true);
    const saved = await call<Plan>(
      selectedPlan ? `/platform/admin/plans/${selectedPlan}` : '/platform/admin/plans',
      {
        method: selectedPlan ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...planForm, features }),
      },
    );
    setBusy(false);
    if (!saved) return;
    setSuccess(`Plan "${saved.name}" saved.`);
    editPlan(saved);
    await refresh();
  }

  async function saveTrial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trial) return;
    setError('');
    setSuccess('');
    setBusy(true);
    const result = await call<TrialSettings>('/platform/admin/trial-settings', {
      method: 'PATCH',
      body: JSON.stringify({
        durationDays: trial.durationDays,
        trialPlanId: trial.trialPlanId,
        notifyDaysBefore: trial.notifyDaysBefore,
      }),
    });
    setBusy(false);
    if (!result) return;
    setTrial(result);
    setSuccess('Trial settings saved. New tenant registrations use these values.');
  }

  async function assignSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant || !selectedPlan) return;
    setError('');
    setSuccess('');
    setBusy(true);
    const result = await call<TenantSubscription>(
      `/platform/admin/tenants/${selectedTenant}/subscription`,
      {
        method: 'POST',
        body: JSON.stringify({ planId: selectedPlan, billingInterval, status: 'ACTIVE' }),
      },
    );
    setBusy(false);
    if (!result) return;
    setSubscription(result);
    setSuccess('Subscription assigned. A platform invoice was generated when the plan has a non-zero price.');
    await refresh();
  }

  async function changeStatus(status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED') {
    if (!selectedTenant) return;
    setError('');
    setSuccess('');
    setBusy(true);
    const result = await call<TenantSubscription>(
      `/platform/admin/tenants/${selectedTenant}/subscription/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    );
    setBusy(false);
    if (!result) return;
    setSubscription(result);
    setSuccess(`Subscription ${status.toLowerCase()}.`);
    await refresh();
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invoice = invoices.find(({ id }) => id === invoiceId);
    if (!invoice) return;
    setError('');
    setSuccess('');
    setBusy(true);
    const result = await call<{ id: string }>(`/platform/admin/invoices/${invoice.id}/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amountMinor: invoice.amountMinor,
        method: paymentMethod,
        reference: reference.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    setBusy(false);
    if (!result) return;
    setSuccess(`Payment recorded for invoice ${invoice.invoiceNumber}.`);
    setInvoiceId('');
    setReference('');
    await refresh();
  }

  return (
    <div className="saas-management">
      {error && <p className="notice error" role="alert">{error}</p>}
      {success && <p className="notice success" role="status">{success}</p>}
      <div className="platform-metrics">
        {(report?.subscriptions ?? []).map(({ status, _count }) => (
          <article className="platform-metric" key={status}><span>{status} subscriptions</span><strong>{_count._all}</strong></article>
        ))}
        {(report?.invoices ?? []).map(({ status, currency, _sum }) => (
          <article className="platform-metric" key={`${status}-${currency}`}>
            <span>{status} · {currency}</span><strong>{((_sum.amountMinor ?? 0) / 100).toFixed(2)}</strong>
          </article>
        ))}
      </div>

      <div className="platform-grid">
        <section className="panel platform-panel">
          <div className="panel-heading">
            <div><h2>Subscription plans</h2><p>Prices use integer minor currency units.</p></div>
            <button type="button" className="button secondary small" onClick={() => editPlan()}>New plan</button>
          </div>
          <div className="table-wrap">
            <table className="platform-table">
              <thead><tr><th>Plan</th><th>Monthly / yearly</th><th>User / branch limits</th><th>Status</th><th /></tr></thead>
              <tbody>{plans.map((plan) => (
                <tr key={plan.id}>
                  <td><strong>{plan.name}</strong><span>{plan.description}</span></td>
                  <td>{plan.currency} {(plan.monthlyPriceMinor / 100).toFixed(2)} / {(plan.yearlyPriceMinor / 100).toFixed(2)}</td>
                  <td>{plan.userLimit} / {plan.branchLimit}</td>
                  <td>{plan.isActive ? 'Active' : 'Inactive'}</td>
                  <td><button className="button secondary small" type="button" onClick={() => editPlan(plan)}>Edit</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <form className="platform-form" onSubmit={(event) => void savePlan(event)}>
            <h3>{selectedPlan ? 'Edit plan' : 'Create plan'}</h3>
            <label>Name<input required minLength={2} maxLength={80} value={planForm.name}
              onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} /></label>
            <label>Description<input maxLength={500} value={planForm.description}
              onChange={(event) => setPlanForm({ ...planForm, description: event.target.value })} /></label>
            <div className="two-fields">
              <label>Monthly amount (minor units)<input required type="number" min={0} value={planForm.monthlyPriceMinor}
                onChange={(event) => setPlanForm({ ...planForm, monthlyPriceMinor: Number(event.target.value) })} /></label>
              <label>Yearly amount (minor units)<input required type="number" min={0} value={planForm.yearlyPriceMinor}
                onChange={(event) => setPlanForm({ ...planForm, yearlyPriceMinor: Number(event.target.value) })} /></label>
            </div>
            <div className="two-fields">
              <label>User limit<input required type="number" min={1} value={planForm.userLimit}
                onChange={(event) => setPlanForm({ ...planForm, userLimit: Number(event.target.value) })} /></label>
              <label>Branch limit<input required type="number" min={1} value={planForm.branchLimit}
                onChange={(event) => setPlanForm({ ...planForm, branchLimit: Number(event.target.value) })} /></label>
            </div>
            <label>Feature access (JSON booleans)<textarea rows={7} value={featuresText}
              onChange={(event) => setFeaturesText(event.target.value)} /></label>
            <label className="inline-check"><input type="checkbox" checked={planForm.isActive}
              onChange={(event) => setPlanForm({ ...planForm, isActive: event.target.checked })} /> Plan is active</label>
            <button className="button primary" disabled={busy}>{selectedPlan ? 'Save plan' : 'Create plan'}</button>
          </form>
        </section>

        <section className="panel platform-panel">
          <h2>Trials and subscriptions</h2>
          {trial && (
            <form className="platform-form" onSubmit={(event) => void saveTrial(event)}>
              <h3>Default trial settings</h3>
              <label>Trial plan<select value={trial.trialPlanId}
                onChange={(event) => setTrial({ ...trial, trialPlanId: event.target.value })}>
                {plans.filter((plan) => plan.isActive).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select></label>
              <div className="two-fields">
                <label>Duration (days)<input type="number" min={1} max={365} value={trial.durationDays}
                  onChange={(event) => setTrial({ ...trial, durationDays: Number(event.target.value) })} /></label>
                <label>Notify before (days)<input type="number" min={0} max={90} value={trial.notifyDaysBefore}
                  onChange={(event) => setTrial({ ...trial, notifyDaysBefore: Number(event.target.value) })} /></label>
              </div>
              <button className="button secondary" disabled={busy}>Save trial settings</button>
            </form>
          )}
          <form className="platform-form" onSubmit={(event) => void assignSubscription(event)}>
            <h3>Assign / upgrade tenant</h3>
            <label>Organization<select required value={selectedTenant} onChange={(event) => setSelectedTenant(event.target.value)}>
              <option value="">Select an organization</option>
              {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} · {tenant.slug}</option>)}
            </select></label>
            <label>Plan<select required value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value)}>
              <option value="">Select an active plan</option>
              {plans.filter((plan) => plan.isActive).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select></label>
            <label>Billing interval<select value={billingInterval}
              onChange={(event) => setBillingInterval(event.target.value as 'MONTHLY' | 'YEARLY')}>
              <option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option>
            </select></label>
            <button className="button primary" disabled={busy || !selectedTenant || !selectedPlan}>Assign and generate invoice</button>
          </form>
          {subscription && (
            <div className="subscription-summary">
              <h3>{subscription.plan.name} · {subscription.status}</h3>
              <p>{subscription.billingInterval.toLowerCase()} · ends {new Date(subscription.trialEndsAt ?? subscription.periodEndsAt).toLocaleDateString()}</p>
              <div className="record-actions">
                {subscription.status === 'SUSPENDED'
                  ? <button className="button primary small" disabled={busy} onClick={() => void changeStatus('ACTIVE')}>Reactivate</button>
                  : <button className="button danger small" disabled={busy} onClick={() => void changeStatus('SUSPENDED')}>Suspend</button>}
                <button className="button secondary small" disabled={busy} onClick={() => void changeStatus('CANCELLED')}>Cancel</button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="panel platform-panel">
        <div className="panel-heading"><div><h2>Platform subscription invoices</h2><p>Platform billing is separate from resident finance.</p></div></div>
        <div className="table-wrap"><table className="platform-table">
          <thead><tr><th>Invoice</th><th>Organization</th><th>Description</th><th>Amount</th><th>Status</th><th>Due</th><th>Payments</th></tr></thead>
          <tbody>{invoices.map((invoice) => (
            <tr key={invoice.id}><td>{invoice.invoiceNumber}</td><td>{invoice.tenant.name}</td>
              <td>{invoice.description}</td><td>{invoice.currency} {(invoice.amountMinor / 100).toFixed(2)}</td>
              <td>{invoice.status}</td><td>{new Date(invoice.dueAt).toLocaleDateString()}</td>
              <td>{invoice.payments.map((payment) => (
                <span key={payment.id}>{payment.method} · {(payment.amountMinor / 100).toFixed(2)} · {new Date(payment.receivedAt).toLocaleDateString()}{payment.reference ? ` · ${payment.reference}` : ''}<br /></span>
              ))}</td></tr>
          ))}</tbody>
        </table></div>
        <form className="platform-filters" onSubmit={(event) => void recordPayment(event)}>
          <label>Record invoice payment<select required value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>
            <option value="">Select pending invoice</option>
            {invoices.filter((invoice) => invoice.status === 'PENDING').map((invoice) => (
              <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {invoice.tenant.name}</option>
            ))}
          </select></label>
          <label>Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
            <option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option>
            <option value="CARD">Card</option><option value="OTHER">Other</option>
          </select></label>
          <label>Reference<input maxLength={150} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <button className="button secondary" disabled={busy || !invoiceId}>Record payment</button>
        </form>
      </section>

      {subscription?.history?.length ? (
        <section className="panel platform-panel">
          <h2>Selected tenant subscription history</h2>
          <div className="table-wrap"><table className="platform-table">
            <thead><tr><th>Event</th><th>Date</th><th>Details</th></tr></thead>
            <tbody>{subscription.history.map((entry) => (
              <tr key={entry.id}><td>{entry.event}</td><td>{new Date(entry.createdAt).toLocaleString()}</td>
                <td><pre>{JSON.stringify(entry.details, null, 2)}</pre></td></tr>
            ))}</tbody>
          </table></div>
        </section>
      ) : null}

      <section className="panel platform-panel">
        <h2>Trials expiring within 30 days</h2>
        {!report?.trialsExpiring.length ? <p className="empty-state">No upcoming trial expirations.</p> : (
          <div className="table-wrap"><table className="platform-table">
            <thead><tr><th>Organization</th><th>Plan</th><th>Expires</th></tr></thead>
            <tbody>{report.trialsExpiring.map((item) => (
              <tr key={item.id}><td>{item.tenant.name} · {item.tenant.slug}</td><td>{item.plan.name}</td>
                <td>{item.trialEndsAt ? new Date(item.trialEndsAt).toLocaleDateString() : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
