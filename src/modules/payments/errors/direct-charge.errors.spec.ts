import { HttpException } from '@nestjs/common';
import {
  DIRECT_CHARGE_ERROR_CODES,
  DIRECT_CHARGE_ERRORS,
  DigikuntzDirectChargeError,
  directChargeCodeForProviderError,
  directChargeException,
} from './direct-charge.errors';

describe('directChargeCodeForProviderError', () => {
  it.each([
    ['INVALID_PHONE', 'PAYMENT_PHONE_INVALID'],
    ['NETWORK_NOT_RESOLVED', 'PAYMENT_PHONE_INVALID'],
    ['AMBIGUOUS_NUMBER', 'PAYMENT_PHONE_INVALID'],
    ['NO_ACTIVE_PAYIN_METHOD', 'PAYMENT_METHOD_UNAVAILABLE'],
    ['METHOD_DISABLED', 'PAYMENT_METHOD_UNAVAILABLE'],
    ['CURRENCY_MISMATCH', 'PAYMENT_METHOD_UNAVAILABLE'],
    ['METHOD_NOT_FOUND', 'PAYMENT_METHOD_UNAVAILABLE'],
    ['AMOUNT_BELOW_MIN', 'PAYMENT_AMOUNT_OUT_OF_RANGE'],
    ['AMOUNT_EXCEEDS_MAX', 'PAYMENT_AMOUNT_OUT_OF_RANGE'],
    ['LIMIT_EXCEEDED', 'PAYMENT_LIMIT_EXCEEDED'],
    ['DIRECT_CHARGE_DISABLED', 'PAYMENT_DIRECT_DISABLED'],
  ])('code fournisseur %s → %s', (providerCode, expected) => {
    expect(directChargeCodeForProviderError(providerCode)).toBe(expected);
  });

  it('code inconnu → PAYMENT_REJECTED', () => {
    expect(directChargeCodeForProviderError('SOMETHING_NEW')).toBe('PAYMENT_REJECTED');
  });

  it('absence de code → PAYMENT_REJECTED', () => {
    expect(directChargeCodeForProviderError(undefined)).toBe('PAYMENT_REJECTED');
  });
});

describe('directChargeException', () => {
  it('construit un corps { statusCode, code, message } avec le statut HTTP de la table', () => {
    const error = directChargeException('PAYMENT_OUTCOME_UNKNOWN');
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      code: 'PAYMENT_OUTCOME_UNKNOWN',
      message: DIRECT_CHARGE_ERRORS.PAYMENT_OUTCOME_UNKNOWN.message,
    });
  });

  it('PAYMENT_DIRECT_DISABLED → 503 ; PAYMENT_PHONE_MISSING → 400', () => {
    expect(directChargeException('PAYMENT_DIRECT_DISABLED').getStatus()).toBe(503);
    expect(directChargeException('PAYMENT_PHONE_MISSING').getStatus()).toBe(400);
  });

  it('INSUFFICIENT_STOCK : 409 avec le même corps structuré que le checkout (items)', () => {
    const items = [{ menuItemId: 'm1', name: 'Frites', requested: 2, available: 0, reason: 'insufficient' }];
    const error = directChargeException('INSUFFICIENT_STOCK', '« Frites » n’est plus disponible.', { items });
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual(expect.objectContaining({ statusCode: 409, code: 'INSUFFICIENT_STOCK', items }));
    expect((error.getResponse() as any).message).toContain('Frites');
  });

  it('permet un message contextuel', () => {
    const error = directChargeException('PAYMENT_IN_PROGRESS', 'Message précis');
    expect((error.getResponse() as any).message).toBe('Message précis');
  });

  it('chaque code possède un statut HTTP et un message français non vide sans mots techniques', () => {
    for (const code of DIRECT_CHARGE_ERROR_CODES) {
      const spec = DIRECT_CHARGE_ERRORS[code];
      expect(spec.httpStatus).toBeGreaterThanOrEqual(400);
      expect(spec.message.trim().length).toBeGreaterThan(0);
      expect(spec.message).not.toMatch(/token|jwt|expired/i);
    }
  });
});

describe('DigikuntzDirectChargeError', () => {
  it('porte le type, le code fournisseur et le statut, sans corps brut', () => {
    const error = new DigikuntzDirectChargeError('rejected', 'LIMIT_EXCEEDED', 400);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('rejected');
    expect(error.providerCode).toBe('LIMIT_EXCEEDED');
    expect(error.httpStatus).toBe(400);
    expect(error.message).not.toMatch(/<|html|secret/i);
  });
});
