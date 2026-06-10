export type CameroonMobileMoneyOperator = 'MTN' | 'ORANGEMONEY';

const MTN_PHONE_PATTERN = /^(?:67\d{7}|65[0-4]\d{6}|68[0-3]\d{6})$/;
const ORANGE_PHONE_PATTERN = /^(?:69\d{7}|65[5-9]\d{6}|68[5-9]\d{6})$/;

export function normalizeCameroonPhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('237') && digits.length === 12 ? digits.slice(3) : digits;
}

export function detectCameroonMobileMoneyOperator(
  phone: string,
): CameroonMobileMoneyOperator | null {
  const normalized = normalizeCameroonPhone(phone);
  if (MTN_PHONE_PATTERN.test(normalized)) return 'MTN';
  if (ORANGE_PHONE_PATTERN.test(normalized)) return 'ORANGEMONEY';
  return null;
}

export function isCameroonMobileMoneyPhone(phone: string): boolean {
  return detectCameroonMobileMoneyOperator(phone) !== null;
}
