/**
 * Strict formatting utility for money and count fields.
 * Data Integrity Requirement:
 * Never display 0 or $0.00 for missing, null, or undefined API values.
 * Display '—' and log a diagnostic console error.
 */

export function formatMoney(
  value: number | null | undefined,
  currency: 'USD' | 'PKR' = 'USD',
  fieldIdentifier = 'financial field'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    console.error(`[Data Integrity Audit] Omitted or invalid money value for '${fieldIdentifier}':`, value);
    return '—';
  }

  if (currency === 'PKR') {
    return `Rs ${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCount(
  value: number | null | undefined,
  fieldIdentifier = 'count field'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    console.error(`[Data Integrity Audit] Omitted or invalid count value for '${fieldIdentifier}':`, value);
    return '—';
  }

  return value.toLocaleString('en-US');
}

export function formatRate(
  value: number | null | undefined,
  fieldIdentifier = 'exchange rate'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    console.error(`[Data Integrity Audit] Missing exchange rate for '${fieldIdentifier}':`, value);
    return '—';
  }

  return value.toFixed(2);
}
