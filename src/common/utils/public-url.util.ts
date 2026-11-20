/**
 * Détection d'une URL locale : un provider de paiement refuse généralement
 * les callbackUrl non publiques. En développement, on omet le callbackUrl
 * (DigiKuntz utilise alors son fallbackUrl de compte) au lieu d'envoyer
 * `http://localhost:4200`, qui provoque un 400 sans code exploitable.
 */
const LOCAL_URL_PATTERN =
  /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i;

export function isLocalUrl(url?: string | null): boolean {
  return !!url && LOCAL_URL_PATTERN.test(String(url).trim());
}

/** URL frontend publique (sans slash final), ou chaîne vide si absente/locale. */
export function publicFrontendUrl(): string {
  const url = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  return url && !isLocalUrl(url) ? url : '';
}