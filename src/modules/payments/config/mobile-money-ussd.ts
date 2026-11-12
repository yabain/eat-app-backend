import type { DirectChargeOperator } from '../utils/mobile-money.util';

const DEFAULT_USSD: Record<DirectChargeOperator, string | undefined> = {
  ORANGEMONEY: '#150*50#',
  MTN: '*126#',
};

const ENV_KEYS: Record<DirectChargeOperator, string> = {
  ORANGEMONEY: 'MOBILE_MONEY_USSD_ORANGE',
  MTN: 'MOBILE_MONEY_USSD_MTN',
};

/**
 * Code USSD de confirmation affiché au client pour un opérateur.
 * - variable absente → valeur par défaut (Orange `#150*50#`, MTN `*126#`) ;
 * - variable vide → `null` (aucun code affiché, le frontend affiche le support).
 * Lu à chaque appel pour rester configurable sans redéploiement du code.
 */
export function getConfirmationUssd(operator: DirectChargeOperator): string | null {
  const raw = process.env[ENV_KEYS[operator]];
  const value = raw === undefined ? DEFAULT_USSD[operator] : raw.trim();
  return value ? value : null;
}
