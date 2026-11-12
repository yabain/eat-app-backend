import { Types } from 'mongoose';
import { toClientPaymentView } from './client-payment-view.util';

describe('toClientPaymentView', () => {
  const base = {
    _id: new Types.ObjectId(),
    orderId: new Types.ObjectId(),
    provider: 'digikuntz',
    amount: 4200,
    currency: 'XAF',
    status: 'processing',
    paymentMethod: 'direct_charge',
    directChargeOutcome: 'prompt_sent',
    directChargeOperator: 'MTN',
    paymentWithTaxes: 4410,
    createdAt: new Date('2026-11-11T10:00:00Z'),
    updatedAt: new Date('2026-11-11T10:01:00Z'),
    providerRef: 'PROV-SECRET',
    transactionRef: 'IN-SECRET',
    callbackPayload: { error: 'SECRET-BODY', phone: '655000000' },
    paymentLink: 'https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-X',
  };

  it('ne renvoie jamais callbackPayload, providerRef ni transactionRef', () => {
    const view = toClientPaymentView(base);

    expect(view).not.toHaveProperty('callbackPayload');
    expect(view).not.toHaveProperty('providerRef');
    expect(view).not.toHaveProperty('transactionRef');
    expect(JSON.stringify(view)).not.toMatch(/SECRET|655000000/);
  });

  it('renvoie les champs client attendus, avec id et sans _id', () => {
    const view = toClientPaymentView(base);

    expect(view).toEqual(
      expect.objectContaining({
        id: String(base._id),
        orderId: String(base.orderId),
        status: 'processing',
        amount: 4200,
        currency: 'XAF',
        provider: 'digikuntz',
        paymentMethod: 'direct_charge',
        outcome: 'prompt_sent',
        operator: 'MTN',
        paymentWithTaxes: 4410,
        createdAt: base.createdAt,
        updatedAt: base.updatedAt,
      }),
    );
    expect(view).not.toHaveProperty('_id');
    expect(view).not.toHaveProperty('completedAt');
  });

  it('lien conservé uniquement s’il est valide (https, hôte autorisé)', () => {
    expect(toClientPaymentView(base).paymentLink).toBe(base.paymentLink);
    expect(toClientPaymentView({ ...base, paymentLink: 'https://evil.example/x' }).paymentLink).toBeNull();
    expect(toClientPaymentView({ ...base, paymentLink: undefined }).paymentLink).toBeNull();
  });

  it('completedAt présent quand le paiement est clos', () => {
    const completedAt = new Date('2026-11-11T10:05:00Z');

    expect(toClientPaymentView({ ...base, completedAt }).completedAt).toEqual(completedAt);
  });

  it('paiement hébergé sans champs directs : outcome et operator à null', () => {
    const view = toClientPaymentView({
      ...base,
      paymentMethod: undefined,
      directChargeOutcome: undefined,
      directChargeOperator: undefined,
      paymentWithTaxes: undefined,
    });

    expect(view.outcome).toBeNull();
    expect(view.operator).toBeNull();
    expect(view.paymentWithTaxes).toBeNull();
  });
});
