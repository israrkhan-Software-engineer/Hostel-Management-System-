'use client';

import type { FormEvent } from 'react';
import { formatStudentMoney as formatMoney } from '@/lib/portal/format';
import type { StudentInvoice, StudentPayment } from '@/lib/portal/types';

interface StudentFeesPanelProps {
  invoices: StudentInvoice[];
  outstandingMinor: number;
  downloadingPaymentId: string;
  paymentSubmittingId: string;
  onDownloadProof: (payment: StudentPayment) => void;
  onSubmitPayment: (event: FormEvent<HTMLFormElement>, invoice: StudentInvoice) => void;
}

function studentPaymentStatus(status: StudentPayment['status']) {
  return status === 'VERIFIED' ? 'APPROVED' : status;
}

export default function StudentFeesPanel({
  invoices,
  outstandingMinor,
  downloadingPaymentId,
  paymentSubmittingId,
  onDownloadProof,
  onSubmitPayment,
}: StudentFeesPanelProps) {
  return (
    <section className="panel student-section">
      <div className="panel-heading"><div><h2>Fees &amp; Payments</h2><p>Monthly rent, outstanding dues, and payment history.</p></div><strong>Outstanding: {formatMoney(outstandingMinor, invoices[0]?.currency ?? 'PKR')}</strong></div>
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
                    <h4>Payment history &amp; proof status</h4>
                    {invoice.payments.map((payment) => (
                      <div className="payment-row" key={payment.id}>
                        <div>
                          <strong>{formatMoney(payment.amountMinor, invoice.currency)}</strong> · {payment.method.replace('_', ' ')} · <span className={`status ${payment.status.toLowerCase()}`}>{studentPaymentStatus(payment.status)}</span>
                          {payment.reference && <p>Reference: {payment.reference}</p>}
                          {payment.rejectionReason && <p className="form-error">Rejected: {payment.rejectionReason}</p>}
                        </div>
                        {payment.proofAvailable && <button className="button secondary small" type="button" disabled={downloadingPaymentId === payment.id} onClick={() => onDownloadProof(payment)}>
                          {downloadingPaymentId === payment.id ? 'Downloading…' : 'Download receipt'}
                        </button>}
                      </div>
                    ))}
                  </div>
                )}
                {invoice.status === 'ISSUED' && payableMinor > 0 && (
                  <details className="finance-action">
                    <summary>Upload payment proof · up to {formatMoney(payableMinor, invoice.currency)}</summary>
                    <form className="stack-form" onSubmit={(event) => onSubmitPayment(event, invoice)}>
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
  );
}
