export function getFinanceSubmissionKey(
  keys: Map<string, { signature: string; key: string }>,
  lockKey: string,
  payload: unknown,
) {
  const signature = JSON.stringify(payload);
  const existing = keys.get(lockKey);
  if (existing?.signature === signature) return existing.key;
  const key = crypto.randomUUID();
  keys.set(lockKey, { signature, key });
  return key;
}

export async function resetFormOnSuccess(
  form: Pick<HTMLFormElement, 'reset'>,
  submit: () => Promise<boolean>,
) {
  const succeeded = await submit();
  if (succeeded) form.reset();
  return succeeded;
}
