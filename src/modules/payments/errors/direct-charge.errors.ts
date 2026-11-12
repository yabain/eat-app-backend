import { HttpException } from '@nestjs/common';

/**
 * Codes stables renvoyés au client pour le paiement mobile money direct.
 * Le frontend se base sur `code`, jamais sur le message.
 */
export const DIRECT_CHARGE_ERROR_CODES = [
  'PAYMENT_PHONE_MISSING',
  'PAYMENT_PHONE_INVALID',
  'PAYMENT_OPERATOR_UNSUPPORTED',
  'PAYMENT_METHOD_UNAVAILABLE',
  'PAYMENT_AMOUNT_OUT_OF_RANGE',
  'PAYMENT_LIMIT_EXCEEDED',
  'PAYMENT_REJECTED',
  'PAYMENT_DIRECT_DISABLED',
  'PAYMENT_IN_PROGRESS',
  'PAYMENT_OUTCOME_UNKNOWN',
  'INSUFFICIENT_STOCK',
] as const;

export type DirectChargeErrorCode = (typeof DIRECT_CHARGE_ERROR_CODES)[number];

export const DIRECT_CHARGE_ERRORS: Record<DirectChargeErrorCode, { httpStatus: number; message: string }> = {
  PAYMENT_PHONE_MISSING: {
    httpStatus: 400,
    message: 'Ajoutez un numéro de téléphone mobile money à votre profil pour payer directement.',
  },
  PAYMENT_PHONE_INVALID: {
    httpStatus: 400,
    message: 'Le numéro de téléphone de votre profil n’est pas valide pour le paiement mobile money.',
  },
  PAYMENT_OPERATOR_UNSUPPORTED: {
    httpStatus: 400,
    message: 'Cet opérateur mobile money n’est pas pris en charge pour le paiement direct.',
  },
  PAYMENT_METHOD_UNAVAILABLE: {
    httpStatus: 400,
    message: 'Ce moyen de paiement mobile money est momentanément indisponible.',
  },
  PAYMENT_AMOUNT_OUT_OF_RANGE: {
    httpStatus: 400,
    message: 'Le montant de la commande n’est pas accepté par ce moyen de paiement.',
  },
  PAYMENT_LIMIT_EXCEEDED: {
    httpStatus: 400,
    message: 'Cette transaction dépasse la limite autorisée pour ce moyen de paiement.',
  },
  PAYMENT_REJECTED: {
    httpStatus: 400,
    message: 'Le paiement mobile money n’a pas pu être initié. Vous pouvez réessayer.',
  },
  PAYMENT_DIRECT_DISABLED: {
    httpStatus: 503,
    message: 'Le paiement mobile money direct est momentanément indisponible.',
  },
  PAYMENT_IN_PROGRESS: {
    httpStatus: 409,
    message: 'Une demande de paiement est déjà en cours pour cette commande. Patientez quelques instants.',
  },
  INSUFFICIENT_STOCK: {
    httpStatus: 409,
    message: 'Un article de votre commande n’est plus disponible dans la quantité demandée.',
  },
  PAYMENT_OUTCOME_UNKNOWN: {
    httpStatus: 409,
    message:
      'Nous ne pouvons pas confirmer si la demande de paiement a abouti. Ne relancez pas le paiement tout de suite : vérifiez le statut de votre commande ou contactez le support.',
  },
};

/** Codes d'erreur fournisseur DigiKuntz (`errors[].code`) → code utilisateur. */
const PROVIDER_CODE_TO_DIRECT_CHARGE_ERROR: Record<string, DirectChargeErrorCode> = {
  INVALID_PHONE: 'PAYMENT_PHONE_INVALID',
  NETWORK_NOT_RESOLVED: 'PAYMENT_PHONE_INVALID',
  AMBIGUOUS_NUMBER: 'PAYMENT_PHONE_INVALID',
  NO_ACTIVE_PAYIN_METHOD: 'PAYMENT_METHOD_UNAVAILABLE',
  METHOD_DISABLED: 'PAYMENT_METHOD_UNAVAILABLE',
  CURRENCY_MISMATCH: 'PAYMENT_METHOD_UNAVAILABLE',
  METHOD_NOT_FOUND: 'PAYMENT_METHOD_UNAVAILABLE',
  AMOUNT_BELOW_MIN: 'PAYMENT_AMOUNT_OUT_OF_RANGE',
  AMOUNT_EXCEEDS_MAX: 'PAYMENT_AMOUNT_OUT_OF_RANGE',
  LIMIT_EXCEEDED: 'PAYMENT_LIMIT_EXCEEDED',
  DIRECT_CHARGE_DISABLED: 'PAYMENT_DIRECT_DISABLED',
};

export function directChargeCodeForProviderError(providerCode?: string): DirectChargeErrorCode {
  if (!providerCode) return 'PAYMENT_REJECTED';
  return PROVIDER_CODE_TO_DIRECT_CHARGE_ERROR[providerCode] ?? 'PAYMENT_REJECTED';
}

/** Exception HTTP au format `{ statusCode, code, message }`. */
export function directChargeException(
  code: DirectChargeErrorCode,
  message?: string,
  extra?: Record<string, unknown>,
): HttpException {
  const spec = DIRECT_CHARGE_ERRORS[code];
  return new HttpException(
    { statusCode: spec.httpStatus, code, message: message ?? spec.message, ...(extra ?? {}) },
    spec.httpStatus,
  );
}

/**
 * Erreur interne du provider. `rejected` = DigiKuntz a refusé la demande (rien débité) ;
 * `unknown` = issue inconnue (timeout, 5xx, réseau) : le paiement ne doit jamais être supprimé.
 * Ne transporte JAMAIS le corps brut de la réponse fournisseur.
 */
export class DigikuntzDirectChargeError extends Error {
  constructor(
    public readonly kind: 'rejected' | 'unknown',
    public readonly providerCode?: string,
    public readonly httpStatus?: number,
  ) {
    super(`DigiKuntz direct charge ${kind}`);
    this.name = 'DigikuntzDirectChargeError';
  }
}
