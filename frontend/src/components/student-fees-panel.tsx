'use client';

import { useState, type FormEvent } from 'react';
import { formatStudentMoney as formatMoney } from '@/lib/portal/format';
import type { StudentInvoice, StudentPayment } from '@/lib/portal/types';
import Icon from './ui/icon';

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
  const [openUploadInvoiceId, setOpenUploadInvoiceId] = useState<string | null>(null);

  return (
    <section className="panel student-section">
      <div className="panel-heading">
        <div>
          <h2>Fees &amp; Payments</h2>
          <p>Monthly rent, outstanding dues, and payment history.</p>
        </div>
        <strong>Outstanding: {formatMoney(outstandingMinor, invoices[0]?.currency ?? 'PKR')}</strong>
      </div>
      {!invoices.length ? (
        <p className="empty-state">No invoices have been issued to your account.</p>
      ) : (
        <div className="record-list">
          {invoices.map((invoice) => {
            const pendingMinor = invoice.payments
              .filter((payment) => payment.status === 'PENDING')
              .reduce((sum, payment) => sum + payment.amountMinor, 0);
            const payableMinor = Math.max(invoice.balanceDueMinor - pendingMinor, 0);
            const isUploadOpen = openUploadInvoiceId === invoice.id;

            return (
              <article className="record student-invoice" key={invoice.id}>
                <div className="record-main">
                  <div>
                    <h3>{invoice.invoiceNumber}</h3>
                    <p>
                      Issued {new Date(invoice.issuedAt).toLocaleDateString()} · Due{' '}
                      {invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString() : 'date not specified'}
                    </p>
                    {invoice.lines.map((line) => (
                      <p key={line.id}>
                        {line.description} · {formatMoney(line.lineAmountMinor, invoice.currency)}
                      </p>
                    ))}
                  </div>
                  <span className={`status ${invoice.balanceDueMinor > 0 ? 'pending' : 'paid'}`}>
                    {invoice.status === 'VOID' ? 'VOID' : invoice.balanceDueMinor > 0 ? 'DUE' : 'PAID'}
                  </span>
                </div>
                <p>
                  <strong>Total:</strong> {formatMoney(invoice.invoiceTotalMinor, invoice.currency)} ·{' '}
                  <strong>Paid:</strong> {formatMoney(invoice.verifiedPaymentsMinor, invoice.currency)} ·{' '}
                  <strong>Balance:</strong> {formatMoney(invoice.balanceDueMinor, invoice.currency)}
                </p>

                {invoice.payments.length > 0 && (
                  <div className="payment-history">
                    <h4>Payment history &amp; proof status</h4>
                    {invoice.payments.map((payment) => (
                      <div className="payment-row" key={payment.id}>
                        <div>
                          <strong>{formatMoney(payment.amountMinor, invoice.currency)}</strong> ·{' '}
                          {payment.method.replace('_', ' ')} ·{' '}
                          <span className={`status ${payment.status.toLowerCase()}`}>
                            {studentPaymentStatus(payment.status)}
                          </span>
                          {payment.reference && <p>Reference: {payment.reference}</p>}
                          {payment.rejectionReason && <p className="form-error">Rejected: {payment.rejectionReason}</p>}
                        </div>
                        {payment.proofAvailable && (
                          <button
                            className="button secondary small"
                            type="button"
                            disabled={downloadingPaymentId === payment.id}
                            onClick={() => onDownloadProof(payment)}
                          >
                            <Icon name="download" size={14} />
                            {downloadingPaymentId === payment.id ? 'Downloading…' : 'Download receipt'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {invoice.status === 'ISSUED' && invoice.balanceDueMinor > 0 && (
                  <div className="payment-proof-wrapper">
                    <button
                      type="button"
                      className={`button ${isUploadOpen ? 'secondary' : 'primary'} upload-proof-trigger-btn`}
                      onClick={() => setOpenUploadInvoiceId(isUploadOpen ? null : invoice.id)}
                    >
                      <Icon name="upload" size={16} />
                      {isUploadOpen ? 'Close Payment Form' : 'Upload Payment Proof'}
                    </button>

                    {isUploadOpen && (
                      <div className="payment-proof-card">
                        <div className="payment-proof-card-header">
                          <div>
                            <h4>Upload Payment Proof for {invoice.invoiceNumber}</h4>
                            <p>Attach bank transfer receipt, mobile wallet screenshot, or deposit slip.</p>
                          </div>
                          <span className="balance-badge">
                            Balance Due: {formatMoney(invoice.balanceDueMinor, invoice.currency)}
                          </span>
                        </div>
                        <form
                          className="stack-form payment-proof-form"
                          onSubmit={(event) => {
                            onSubmitPayment(event, invoice);
                          }}
                        >
                          <div className="form-row">
                            <label>
                              Amount paid ({invoice.currency})
                              <input
                                name="amount"
                                required
                                type="number"
                                min={0.01}
                                step={0.01}
                                defaultValue={payableMinor > 0 ? (payableMinor / 100).toFixed(2) : undefined}
                                placeholder="0.00"
                              />
                            </label>
                            <label>
                              Payment method
                              <select name="method" defaultValue="BANK_TRANSFER">
                                <option value="BANK_TRANSFER">Bank transfer</option>
                                <option value="MOBILE_WALLET">Mobile wallet (Easypaisa/JazzCash/etc.)</option>
                                <option value="CASH">Cash</option>
                              </select>
                            </label>
                          </div>
                          <label>
                            Transaction reference / ID
                            <input
                              name="reference"
                              maxLength={200}
                              placeholder="e.g. Bank Ref / Transaction ID / Slip No."
                            />
                          </label>
                          <label>
                            Notes (optional)
                            <textarea
                              name="proofNotes"
                              maxLength={1000}
                              rows={2}
                              placeholder="Any additional information regarding this payment..."
                            />
                          </label>
                          <label className="file-upload-field">
                            Screenshot / receipt document
                            <input
                              name="proof"
                              required
                              type="file"
                              accept="image/jpeg,image/png,image/webp,application/pdf"
                            />
                            <span className="upload-hint">Supported formats: JPEG, PNG, WebP or PDF · Max size: 5 MB</span>
                          </label>
                          <div className="form-actions">
                            <button
                              className="button primary"
                              type="submit"
                              disabled={paymentSubmittingId === invoice.id}
                            >
                              <Icon name="upload" size={16} />
                              {paymentSubmittingId === invoice.id ? 'Submitting…' : 'Submit payment for verification'}
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() => setOpenUploadInvoiceId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
