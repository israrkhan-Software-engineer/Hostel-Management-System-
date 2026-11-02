import { getFinanceSubmissionKey, resetFormOnSuccess } from './submission';

describe('finance form submission helpers', () => {
  it('keeps form values available after a failed request and resets only after success', async () => {
    const form = { reset: jest.fn() };
    const submit = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(resetFormOnSuccess(form, submit)).resolves.toBe(false);
    expect(form.reset).not.toHaveBeenCalled();

    await expect(resetFormOnSuccess(form, submit)).resolves.toBe(true);
    expect(form.reset).toHaveBeenCalledTimes(1);
  });

  it('reuses the same key for an identical retry and rotates it when details change', () => {
    const keys = new Map<string, { signature: string; key: string }>();
    const original = { amountMinor: 12500, method: 'CASH' };
    const first = getFinanceSubmissionKey(keys, 'payment:invoice-1', original);

    expect(getFinanceSubmissionKey(keys, 'payment:invoice-1', original)).toBe(first);
    expect(getFinanceSubmissionKey(keys, 'payment:invoice-1', {
      amountMinor: 13000,
      method: 'CASH',
    })).not.toBe(first);
  });
});
