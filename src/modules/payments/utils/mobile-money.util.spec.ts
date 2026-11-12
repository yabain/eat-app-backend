import { detectMobileMoneyOperator, normalizeCmPhoneForDirectCharge } from './mobile-money.util';

/** Complète un préfixe à 3 chiffres en numéro local de 9 chiffres (6XXXXXXXX). */
const localNumberWithPrefix = (prefix3: string) => `${prefix3}123456`;

describe('detectMobileMoneyOperator', () => {
  it.each(['650', '654', '670', '679', '680', '685'])('préfixe %s → MTN', (prefix) => {
    expect(detectMobileMoneyOperator(localNumberWithPrefix(prefix))).toBe('MTN');
  });

  it.each(['655', '659', '686', '689', '690', '699'])('préfixe %s → ORANGEMONEY', (prefix) => {
    expect(detectMobileMoneyOperator(localNumberWithPrefix(prefix))).toBe('ORANGEMONEY');
  });

  it('régression : 686 à 689 sont Orange (le code précédent les envoyait en MTN)', () => {
    expect(detectMobileMoneyOperator('686123456')).toBe('ORANGEMONEY');
    expect(detectMobileMoneyOperator('689123456')).toBe('ORANGEMONEY');
  });

  it.each(['660', '669', '664'])('préfixe %s non listé → null (pas de défaut MTN)', (prefix) => {
    expect(detectMobileMoneyOperator(localNumberWithPrefix(prefix))).toBeNull();
  });

  it.each(['500123456', '211123456', '100123456', '200123456', '5', ''])(
    'numéro hors 6XX (%s) → null',
    (phone) => {
      expect(detectMobileMoneyOperator(phone)).toBeNull();
    },
  );

  it('accepte le format international avec espaces et +', () => {
    expect(detectMobileMoneyOperator('+237 6 55 00 00 00')).toBe('ORANGEMONEY');
  });

  it('accepte 237 collé au numéro', () => {
    expect(detectMobileMoneyOperator('237655000000')).toBe('ORANGEMONEY');
  });

  it('accepte le format local', () => {
    expect(detectMobileMoneyOperator('655000000')).toBe('ORANGEMONEY');
  });

  it('valeur absente → null', () => {
    expect(detectMobileMoneyOperator(undefined)).toBeNull();
    expect(detectMobileMoneyOperator(null)).toBeNull();
  });
});

describe('normalizeCmPhoneForDirectCharge', () => {
  it('6XXXXXXXX → 2376XXXXXXXX', () => {
    expect(normalizeCmPhoneForDirectCharge('650123456')).toBe('237650123456');
  });

  it('237 6XXXXXXXX avec espaces → 2376XXXXXXXX', () => {
    expect(normalizeCmPhoneForDirectCharge('237 650 123 456')).toBe('237650123456');
  });

  it('+237 6XXXXXXXX avec espaces → 2376XXXXXXXX', () => {
    expect(normalizeCmPhoneForDirectCharge('+237 6 50 12 34 56')).toBe('237650123456');
  });

  it('5XXXXXXXX → null', () => {
    expect(normalizeCmPhoneForDirectCharge('550123456')).toBeNull();
  });

  it('8 chiffres → null', () => {
    expect(normalizeCmPhoneForDirectCharge('65012345')).toBeNull();
  });

  it('chaîne vide ou undefined → null', () => {
    expect(normalizeCmPhoneForDirectCharge('')).toBeNull();
    expect(normalizeCmPhoneForDirectCharge(undefined)).toBeNull();
  });
});
