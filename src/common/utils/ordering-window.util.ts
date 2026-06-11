/**
 * Vrai si le moment courant tombe dans la fenêtre [startHour, endHour) du fuseau donné.
 * - `endHour = 24` est traité comme "minuit du jour suivant" (donc ouvert jusqu'à la fin de la journée).
 * - Si `startHour < endHour` (cas standard, ex 7→24), la fenêtre est [startHour, endHour).
 * - Si `startHour > endHour` (fenêtre qui chevauche minuit, ex 22→6), on est ouvert si hour >= start OU hour < end.
 * - Si `startHour === endHour`, la fenêtre est vide (jamais ouvert) — utile pour fermer manuellement.
 */
export function isOrderingOpen(
  startHour: number,
  endHour: number,
  timezone: string,
  now: Date = new Date(),
): boolean {
  const normalizedStart = clampHour(startHour, 7);
  const normalizedEnd = clampEnd(endHour, 24);
  if (normalizedStart === normalizedEnd) return false;

  const currentHour = currentHourInTz(now, timezone || 'Africa/Douala');

  if (normalizedStart < normalizedEnd) {
    // Cas standard: ex 7→24 → ouvert si 7 ≤ hour < 24 (toujours vrai à 23h, faux à 6h)
    return currentHour >= normalizedStart && currentHour < normalizedEnd;
  }

  // Fenêtre traversant minuit (ex 22→6): ouvert si hour ≥ 22 OU hour < 6
  return currentHour >= normalizedStart || currentHour < normalizedEnd;
}

export function currentHourInTz(now: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
  });
  const hourStr = formatter.format(now);
  const hour = Number(hourStr);
  return Number.isFinite(hour) ? hour : 0;
}

function clampHour(value: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function clampEnd(value: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(24, Math.floor(n)));
}
