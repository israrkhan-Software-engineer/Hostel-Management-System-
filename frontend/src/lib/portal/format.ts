export function formatStudentMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency }).format(amountMinor / 100);
}
