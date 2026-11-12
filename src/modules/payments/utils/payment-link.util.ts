const ALLOWED_PAYMENT_LINK_HOST = 'checkout.flutterwave.com';

/**
 * Lien de paiement hébergé accepté pour être persisté et renvoyé au client :
 * https uniquement, hôte exact `checkout.flutterwave.com`, sans identifiants ni port explicite dans l'URL.
 */
export function isAllowedPaymentLink(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:'
      && url.hostname === ALLOWED_PAYMENT_LINK_HOST
      && !url.username
      && !url.password
      && url.port === ''
    );
  } catch {
    return false;
  }
}
