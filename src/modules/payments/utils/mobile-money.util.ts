/**
 * Opérateurs mobile money utilisables pour le paiement direct DigiKuntz.
 * Source : table de routage de la doc DigiKuntz (direct-charge.routing).
 */
export type DirectChargeOperator = 'ORANGEMONEY' | 'MTN';

export const DIRECT_CHARGE_OPERATORS: DirectChargeOperator[] = ['ORANGEMONEY', 'MTN'];

const ORANGE_PREFIXES: Array<[number, number]> = [
  [655, 659],
  [686, 689],
  [690, 699],
];
const MTN_PREFIXES: Array<[number, number]> = [
  [650, 654],
  [670, 679],
  [680, 685],
];

function inRanges(value: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([from, to]) => value >= from && value <= to);
}

/**
 * Détermine l'opérateur à partir des 3 premiers chiffres du numéro local.
 * Un préfixe absent de la table renvoie `null` : on ne suppose JAMAIS MTN
 * par défaut (un client Orange recevrait alors un code USSD MTN).
 */
export function detectMobileMoneyOperator(phone?: string | null): DirectChargeOperator | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const local = digits.length > 3 && digits.startsWith('237') ? digits.slice(3) : digits;
  if (!/^\d{3}/.test(local)) return null;

  const prefix = Number(local.slice(0, 3));
  if (inRanges(prefix, ORANGE_PREFIXES)) return 'ORANGEMONEY';
  if (inRanges(prefix, MTN_PREFIXES)) return 'MTN';
  return null;
}

/**
 * Normalise un numéro camerounais au format attendu par `/dev/direct-charge` :
 * **9 chiffres locaux** (ex. `691224472`), conformément à la requête de
 * référence du provider. Accepte `6XXXXXXXX`, `237 6XXXXXXXX` et
 * `+237 6XXXXXXXX` (espaces et symboles ignorés). Renvoie `null` sinon.
 */
export function normalizeCmPhoneForDirectCharge(raw?: string | null): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (/^6\d{8}$/.test(digits)) return digits;
  if (/^2376\d{8}$/.test(digits)) return digits.slice(3);
  return null;
}
