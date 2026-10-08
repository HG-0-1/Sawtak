export function normalizeJordanianMobile(input: string): string | null {
  const cleaned = input.replace(/[\s()-]/g, '');
  if (/^07[789]\d{7}$/.test(cleaned)) return `+962${cleaned.slice(1)}`;
  if (/^\+9627[789]\d{7}$/.test(cleaned)) return cleaned;
  if (/^9627[789]\d{7}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

export function last4(phone: string) { return phone.slice(-4); }
