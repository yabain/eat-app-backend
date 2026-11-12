/**
 * Normalisation des statuts fournis par DigiKuntz.
 * Les listes/historique utilisent un préfixe `transaction_` (ex.
 * transaction_payin_success, transaction_payout_pending), alors que les GET
 * unitaires renvoient les suffixes nus (payin_*, payout_*).
 *
 * Cette utilitaire garantit que les deux formats sont traités de façon
 * cohérente, à la fois dans le provider (fetchTransaction) et dans la
 * réception webhook / sync cron.
 */
export function normalizeDigikuntzStatus(status?: string | null): string | null {
  if (!status) return null;
  const s = String(status).trim();
  return s.startsWith('transaction_') ? s.slice('transaction_'.length) : s;
}