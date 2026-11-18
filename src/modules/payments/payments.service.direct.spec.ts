import { BadRequestException, ForbiddenException, HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentsService } from './payments.service';
import { DigikuntzDirectChargeError } from './errors/direct-charge.errors';

const CLIENT_ID = new Types.ObjectId();
const OTHER_CLIENT_ID = new Types.ObjectId();
const RESTAURANT_ID = new Types.ObjectId();
const ORDER_ID = new Types.ObjectId();
const ORANGE_PHONE = '655000000';
const MTN_PHONE = '670123456';
const VALID_LINK = 'https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-XXXX';
const EVIL_LINK = 'https://evil.example/pay';

const clientActor = { sub: String(CLIENT_ID), email: 'client@example.com', role: 'client' };

function createModelMock() {
  return {
    create: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    findOneAndUpdate: jest.fn(),
  };
}

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    _id: ORDER_ID,
    orderNumber: 'ORD-TEST-1',
    userId: CLIENT_ID,
    restaurantId: RESTAURANT_ID,
    paymentStatus: 'pending',
    orderStatus: 'pending_payment',
    createdAt: new Date(),
    items: [],
    pricingSnapshot: { paymentAmount: 4200, grandTotal: 4200, platformFee: 0 },
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeUser(overrides: Record<string, any> = {}) {
  return { _id: CLIENT_ID, phone: ORANGE_PHONE, email: 'client@example.com', firstName: 'Jean', lastName: 'Dupont', ...overrides };
}

function makeStoredPayment(overrides: Record<string, any> = {}) {
  return {
    _id: new Types.ObjectId(),
    orderId: ORDER_ID,
    amount: 4200,
    status: 'processing',
    paymentMethod: 'direct_charge',
    directChargeOperator: 'ORANGEMONEY',
    initiatedAt: new Date(),
    createdAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const acceptedResult = {
  providerRef: 'PROV-1',
  transactionRef: 'IN535#261111013004',
  paymentWithTaxes: 4410,
  invoiceTaxes: 210,
  status: 'payin_pending',
  paymentMethodCode: 'ORANGEMONEY',
  refused: false,
};

const refusedResult = {
  ...acceptedResult,
  paymentMethodCode: 'MTN',
  refused: true,
  paymentLink: VALID_LINK,
  refusalReason: 'DIRECT_CHARGE_REFUSED',
};

async function captureError(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

function errorCode(error: any): string {
  return (error.getResponse() as any).code;
}

describe('PaymentsService — paiement mobile money direct', () => {
  let service: PaymentsService;
  let paymentModel: ReturnType<typeof createModelMock>;
  let orderModel: ReturnType<typeof createModelMock>;
  let userModel: ReturnType<typeof createModelMock>;
  let provider: {
    initiateDirectCharge: jest.Mock;
    getTransactionStatus: jest.Mock;
    getTransactionStatusOrThrow: jest.Mock;
    initiatePayment: jest.Mock;
  };
  let auditLogs: { record: jest.Mock };
  let inventory: { adjustStock: jest.Mock };
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };
  let connection: { startSession: jest.Mock };
  let order: ReturnType<typeof makeOrder>;
  let created: any;

  /** Rend `paymentModel.findOne(...).sort(...)` renvoyant le Payment donné. */
  function setExistingPayment(payment: any) {
    paymentModel.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(payment) });
  }

  beforeEach(() => {
    delete process.env.MOBILE_MONEY_USSD_ORANGE;
    delete process.env.MOBILE_MONEY_USSD_MTN;

    paymentModel = createModelMock();
    orderModel = createModelMock();
    userModel = createModelMock();
    provider = {
      initiateDirectCharge: jest.fn(),
      getTransactionStatus: jest.fn().mockResolvedValue(null),
      getTransactionStatusOrThrow: jest.fn().mockResolvedValue({ id: 'PROV-1', status: 'payin_pending', data: {} }),
      initiatePayment: jest.fn(),
    };
    auditLogs = { record: jest.fn() };
    inventory = { adjustStock: jest.fn().mockResolvedValue({}) };
    session = {
      withTransaction: jest.fn(async (fn: any) => fn(session)),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };

    order = makeOrder();
    orderModel.findById.mockResolvedValue(order);
    userModel.findById.mockResolvedValue(makeUser());
    setExistingPayment(null);

    created = undefined;
    // Le chemin direct appelle create([doc]) ; le chemin hébergé appelle create(doc).
    paymentModel.create.mockImplementation(async (data: any) => {
      const doc = Array.isArray(data) ? data[0] : data;
      created = { _id: new Types.ObjectId(), ...doc, save: jest.fn().mockResolvedValue(undefined) };
      return Array.isArray(data) ? [created] : created;
    });

    service = new PaymentsService(
      paymentModel as any,
      orderModel as any,
      userModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      inventory as any,
      provider as any,
      {} as any,
      {} as any,
      auditLogs as any,
      connection as any,
    );
  });

  describe('succès (prompt_sent)', () => {
    it('Orange : outcome prompt_sent, code USSD #150*50#, pas de lien, devise XAF', async () => {
      provider.initiateDirectCharge.mockResolvedValue(acceptedResult);

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(result).toEqual(
        expect.objectContaining({
          orderId: String(ORDER_ID),
          amount: 4200,
          currency: 'XAF',
          status: 'processing',
          operator: 'ORANGEMONEY',
          outcome: 'prompt_sent',
          fallback: false,
          paymentLink: null,
          ussdCode: '#150*50#',
        }),
      );
      expect(typeof result.paymentId).toBe('string');
    });

    it('MTN : code USSD par défaut *126#', async () => {
      userModel.findById.mockResolvedValue(makeUser({ phone: MTN_PHONE }));
      provider.initiateDirectCharge.mockResolvedValue({ ...acceptedResult, paymentMethodCode: 'MTN' });

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(result.operator).toBe('MTN');
      expect(result.ussdCode).toBe('*126#');
    });

    it('MTN : variable MOBILE_MONEY_USSD_MTN vide → ussdCode null, aucun code inventé', async () => {
      process.env.MOBILE_MONEY_USSD_MTN = '';
      userModel.findById.mockResolvedValue(makeUser({ phone: MTN_PHONE }));
      provider.initiateDirectCharge.mockResolvedValue({ ...acceptedResult, paymentMethodCode: 'MTN' });

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(result.ussdCode).toBeNull();
    });

    it('envoie le téléphone normalisé 237… et l’opérateur local explicite au provider', async () => {
      provider.initiateDirectCharge.mockResolvedValue(acceptedResult);

      await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(provider.initiateDirectCharge).toHaveBeenCalledTimes(1);
      expect(provider.initiateDirectCharge.mock.calls[0][0]).toEqual(
        expect.objectContaining({ userPhone: `237${ORANGE_PHONE}`, paymentMethodCode: 'ORANGEMONEY', estimation: 4200 }),
      );
    });

    it('crée le Payment (calling) AVANT l’appel provider, puis persiste l’issue', async () => {
      provider.initiateDirectCharge.mockResolvedValue(acceptedResult);

      await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(paymentModel.create.mock.calls[0][0][0]).toEqual(
        expect.objectContaining({
          paymentMethod: 'direct_charge',
          directChargeOutcome: 'calling',
          directChargeOperator: 'ORANGEMONEY',
          status: 'processing',
        }),
      );
      const createOrder = paymentModel.create.mock.invocationCallOrder[0];
      const providerOrder = provider.initiateDirectCharge.mock.invocationCallOrder[0];
      expect(createOrder).toBeLessThan(providerOrder);
      expect(created.directChargeOutcome).toBe('prompt_sent');
      expect(created.providerRef).toBe('PROV-1');
      expect(created.directChargeOperator).toBe('ORANGEMONEY');
      expect(created.paymentLink).toBeUndefined();
      expect(created.save).toHaveBeenCalled();
      expect(order.paymentStatus).toBe('processing');
      expect(order.save).toHaveBeenCalled();
    });

    it('ne renvoie jamais le téléphone ni dans la réponse ni dans l’audit', async () => {
      provider.initiateDirectCharge.mockResolvedValue(acceptedResult);

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(JSON.stringify(result)).not.toContain(ORANGE_PHONE);
      expect(JSON.stringify(auditLogs.record.mock.calls)).not.toContain(ORANGE_PHONE);
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payment.initiate_direct', actorId: String(CLIENT_ID) }),
      );
    });

    it('opérateur fournisseur différent : le fournisseur fait foi pour l’affichage', async () => {
      provider.initiateDirectCharge.mockResolvedValue({ ...acceptedResult, paymentMethodCode: 'MTN' });

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(result.operator).toBe('MTN');
      expect(created.directChargeOperator).toBe('MTN');
    });
  });

  describe('refus DigiKuntz (fallback)', () => {
    it('lien valide : outcome refused, lien persisté et renvoyé, aucune suppression', async () => {
      provider.initiateDirectCharge.mockResolvedValue(refusedResult);

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(result).toEqual(
        expect.objectContaining({ outcome: 'refused', fallback: true, paymentLink: VALID_LINK }),
      );
      expect(created.paymentLink).toBe(VALID_LINK);
      expect(created.directChargeOutcome).toBe('refused');
      expect(paymentModel.deleteOne).not.toHaveBeenCalled();
    });

    it('lien hors allowlist : FAILED + PAYMENT_REJECTED, lien non renvoyé', async () => {
      provider.initiateDirectCharge.mockResolvedValue({ ...refusedResult, paymentLink: EVIL_LINK });

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(400);
      expect(errorCode(error)).toBe('PAYMENT_REJECTED');
      expect(JSON.stringify(error.getResponse())).not.toContain('evil.example');
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing' }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'failed', directChargeOutcome: 'rejected' }),
        }),
      );
      expect(paymentModel.deleteOne).not.toHaveBeenCalled();
    });
  });

  describe('issues DigiKuntz', () => {
    it('issue inconnue (502) : Payment conservé (jamais supprimé), outcome unknown, 409 PAYMENT_OUTCOME_UNKNOWN', async () => {
      provider.initiateDirectCharge.mockRejectedValue(new DigikuntzDirectChargeError('unknown', undefined, 502));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(error.getStatus()).toBe(409);
      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(paymentModel.deleteOne).not.toHaveBeenCalled();
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: created._id }),
        expect.objectContaining({ $set: expect.objectContaining({ directChargeOutcome: 'unknown' }) }),
      );
      expect(paymentModel.updateOne.mock.calls.some(([, update]) => update?.$set?.status === 'failed')).toBe(false);
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payment.initiate_direct_unknown' }),
      );
    });

    it('timeout (unknown sans code) : même traitement, jamais supprimé', async () => {
      provider.initiateDirectCharge.mockRejectedValue(new DigikuntzDirectChargeError('unknown'));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(paymentModel.deleteOne).not.toHaveBeenCalled();
    });

    it('rejet certain NO_ACTIVE_PAYIN_METHOD : FAILED, 400 PAYMENT_METHOD_UNAVAILABLE, pas d’issue inconnue', async () => {
      provider.initiateDirectCharge.mockRejectedValue(
        new DigikuntzDirectChargeError('rejected', 'NO_ACTIVE_PAYIN_METHOD', 400),
      );

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(error.getStatus()).toBe(400);
      expect(errorCode(error)).toBe('PAYMENT_METHOD_UNAVAILABLE');
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: created._id }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'failed', directChargeOutcome: 'rejected' }),
        }),
      );
      expect(paymentModel.updateOne.mock.calls.some(([, update]) => update?.$set?.directChargeOutcome === 'unknown')).toBe(false);
    });

    it('DIRECT_CHARGE_DISABLED : 503 PAYMENT_DIRECT_DISABLED, FAILED', async () => {
      provider.initiateDirectCharge.mockRejectedValue(
        new DigikuntzDirectChargeError('rejected', 'DIRECT_CHARGE_DISABLED', 503),
      );

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(error.getStatus()).toBe(503);
      expect(errorCode(error)).toBe('PAYMENT_DIRECT_DISABLED');
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
      );
    });

    it('accepté par le provider mais persistance en échec : issue inconnue, jamais supprimée', async () => {
      provider.initiateDirectCharge.mockResolvedValue(acceptedResult);
      paymentModel.create.mockImplementationOnce(async (data: any) => {
        const doc = Array.isArray(data) ? data[0] : data;
        created = {
          _id: new Types.ObjectId(),
          ...doc,
          save: jest.fn().mockRejectedValue(new Error('db down')),
        };
        return [created];
      });

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(error.getStatus()).toBe(409);
      expect(paymentModel.deleteOne).not.toHaveBeenCalled();
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ directChargeOutcome: 'unknown' }) }),
      );
    });
  });

  describe('validation avant création du Payment', () => {
    it('téléphone absent → PAYMENT_PHONE_MISSING, aucun Payment ni appel provider', async () => {
      userModel.findById.mockResolvedValue(makeUser({ phone: undefined }));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_PHONE_MISSING');
      expect(error.getStatus()).toBe(400);
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('téléphone invalide → PAYMENT_PHONE_INVALID, aucun Payment', async () => {
      userModel.findById.mockResolvedValue(makeUser({ phone: '550123456' }));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_PHONE_INVALID');
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('préfixe 660 (hors table) → PAYMENT_OPERATOR_UNSUPPORTED, aucun Payment, pas de MTN par défaut', async () => {
      userModel.findById.mockResolvedValue(makeUser({ phone: '660123456' }));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_OPERATOR_UNSUPPORTED');
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('régression : 686 est envoyé en ORANGEMONEY', async () => {
      userModel.findById.mockResolvedValue(makeUser({ phone: '686123456' }));
      provider.initiateDirectCharge.mockResolvedValue({ ...acceptedResult, paymentMethodCode: 'ORANGEMONEY' });

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(provider.initiateDirectCharge.mock.calls[0][0].paymentMethodCode).toBe('ORANGEMONEY');
      expect(result.operator).toBe('ORANGEMONEY');
    });
  });

  describe('contrôle d’accès : réservé au client propriétaire', () => {
    it('manager du restaurant → 403, aucune lecture de Payment ni appel provider', async () => {
      const manager = { sub: 'm1', role: 'manager', restaurantId: RESTAURANT_ID };

      await expect(service.initiateDirectPayment(String(ORDER_ID), manager)).rejects.toBeInstanceOf(ForbiddenException);
      expect(paymentModel.findOne).not.toHaveBeenCalled();
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('admin → 403', async () => {
      const admin = { sub: String(new Types.ObjectId()), role: 'admin' };

      await expect(service.initiateDirectPayment(String(ORDER_ID), admin)).rejects.toBeInstanceOf(ForbiddenException);
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('le rôle compte, pas seulement l’identifiant : manager dont le sub égale le propriétaire → 403', async () => {
      const managerWithOwnerId = { sub: String(CLIENT_ID), role: 'manager', restaurantId: RESTAURANT_ID };

      await expect(service.initiateDirectPayment(String(ORDER_ID), managerWithOwnerId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('le rôle compte : admin dont le sub égale le propriétaire → 403', async () => {
      const adminWithOwnerId = { sub: String(CLIENT_ID), role: 'admin' };

      await expect(service.initiateDirectPayment(String(ORDER_ID), adminWithOwnerId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('client qui n’est pas propriétaire → 403', async () => {
      const otherClient = { sub: String(OTHER_CLIENT_ID), role: 'client' };

      await expect(service.initiateDirectPayment(String(ORDER_ID), otherClient)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });
  });

  describe('réutilisation idempotente d’un paiement en cours', () => {
    it('issue inconnue existante → 409 PAYMENT_OUTCOME_UNKNOWN, aucun appel provider', async () => {
      setExistingPayment(makeStoredPayment({ directChargeOutcome: 'unknown' }));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
      expect(paymentModel.create).not.toHaveBeenCalled();
    });

    it('calling récent (< 60 s) → 409 PAYMENT_IN_PROGRESS', async () => {
      setExistingPayment(makeStoredPayment({ directChargeOutcome: 'calling', initiatedAt: new Date() }));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_IN_PROGRESS');
      expect(error.getStatus()).toBe(409);
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('calling ancien → 409 PAYMENT_OUTCOME_UNKNOWN et jamais libéré (pas de passage en FAILED)', async () => {
      const old = new Date(Date.now() - 5 * 60 * 1000);
      setExistingPayment(makeStoredPayment({ directChargeOutcome: 'calling', initiatedAt: old }));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing' }),
        expect.objectContaining({ $set: expect.objectContaining({ directChargeOutcome: 'unknown' }) }),
      );
      expect(paymentModel.updateOne.mock.calls.some(([, update]) => update?.$set?.status === 'failed')).toBe(false);
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
      expect(paymentModel.create).not.toHaveBeenCalled();
    });

    it('refused existant : même lien renvoyé, aucun nouvel appel provider', async () => {
      provider.getTransactionStatusOrThrow.mockResolvedValue({ id: 'PROV-1', status: 'payin_pending', data: {} });
      setExistingPayment(
        makeStoredPayment({
          directChargeOutcome: 'refused',
          providerRef: 'PROV-1',
          paymentLink: VALID_LINK,
          directChargeOperator: 'MTN',
        }),
      );

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(result).toEqual(expect.objectContaining({ outcome: 'refused', fallback: true, paymentLink: VALID_LINK }));
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
      expect(paymentModel.create).not.toHaveBeenCalled();
    });

    it('prompt_sent existant avec statut pending : réponse reconstruite, aucune création', async () => {
      provider.getTransactionStatusOrThrow.mockResolvedValue({ id: 'PROV-1', status: 'payin_pending', data: {} });
      setExistingPayment(makeStoredPayment({ directChargeOutcome: 'prompt_sent', providerRef: 'PROV-1' }));

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(result).toEqual(
        expect.objectContaining({ outcome: 'prompt_sent', fallback: false, paymentLink: null, operator: 'ORANGEMONEY' }),
      );
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('prompt_sent existant dont le statut distant est payin_error : clôturé puis nouvelle tentative', async () => {
      provider.getTransactionStatusOrThrow.mockResolvedValue({ id: 'PROV-1', status: 'payin_error', data: {} });
      orderModel.findOneAndUpdate.mockResolvedValue({ orderStatus: 'payment_failed', paymentStatus: 'failed' });
      paymentModel.findOneAndUpdate.mockResolvedValue({
        status: 'failed',
        callbackPayload: { status: 'payin_error' },
        completedAt: new Date(),
      });
      const existing = makeStoredPayment({ directChargeOutcome: 'prompt_sent', providerRef: 'PROV-1' });
      setExistingPayment(existing);
      provider.initiateDirectCharge.mockResolvedValue(acceptedResult);

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(existing.status).toBe('failed');
      // Nouveau contrat : la clôture passe par un claim atomique, plus par un save() d'un document potentiellement périmé.
      expect(existing.save).not.toHaveBeenCalled();
      expect(paymentModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: existing._id }),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
        expect.objectContaining({ new: true }),
      );
      expect(paymentModel.create).toHaveBeenCalledTimes(1);
      expect(result.outcome).toBe('prompt_sent');
    });

    it('Payment hébergé en cours sur la commande → 409 PAYMENT_IN_PROGRESS, aucun appel provider', async () => {
      setExistingPayment(makeStoredPayment({ paymentMethod: undefined, directChargeOutcome: undefined, providerRef: 'HOSTED-1' }));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_IN_PROGRESS');
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
      expect(paymentModel.create).not.toHaveBeenCalled();
    });

    it('course à la création (E11000) avec un calling récent → 409 PAYMENT_IN_PROGRESS', async () => {
      const concurrent = makeStoredPayment({ directChargeOutcome: 'calling', initiatedAt: new Date() });
      paymentModel.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
      paymentModel.findOne
        .mockReturnValueOnce({ sort: jest.fn().mockResolvedValue(null) })
        .mockReturnValueOnce({ sort: jest.fn().mockResolvedValue(concurrent) });

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_IN_PROGRESS');
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });
  });

  describe('expiration automatique des commandes (B5)', () => {
    async function runExpire() {
      return (service as any).expireStalePendingOrders();
    }

    it('TTL par défaut : 30 min pour la commande et pour la fenêtre de secours', () => {
      delete process.env.ORDER_PAYMENT_TIMEOUT_MINUTES;
      delete process.env.PAYMENT_TIMEOUT_MINUTES;
      delete process.env.PAYMENT_HOSTED_FALLBACK_TIMEOUT_MINUTES;

      expect((service as any).getOrderPaymentTimeoutMs()).toBe(30 * 60 * 1000);
      expect((service as any).getHostedFallbackTimeoutMs()).toBe(30 * 60 * 1000);
    });

    it.each(['unknown', 'calling'])('commande dont le dernier Payment est %s : jamais expirée', async (outcome) => {
      orderModel.find.mockResolvedValue([order]);
      setExistingPayment(makeStoredPayment({ directChargeOutcome: outcome, providerRef: undefined }));

      await runExpire();

      expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(provider.getTransactionStatus).not.toHaveBeenCalled();
    });

    it('commande avec un Payment hébergé sans issue directe : expirée normalement', async () => {
      orderModel.find.mockResolvedValue([order]);
      orderModel.findOneAndUpdate.mockResolvedValue({ ...order, orderStatus: 'payment_failed' });
      setExistingPayment(makeStoredPayment({ paymentMethod: undefined, directChargeOutcome: undefined, providerRef: undefined }));

      await runExpire();

      expect(orderModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('direct charge refusé + lien hébergé encore actif (payin_pending) : commande conservée', async () => {
      orderModel.find.mockResolvedValue([order]);
      setExistingPayment(makeStoredPayment({
        directChargeOutcome: 'refused',
        providerRef: 'PROV-1',
        paymentLink: VALID_LINK,
        createdAt: new Date(Date.now() - 15 * 60 * 1000),
      }));
      provider.getTransactionStatus.mockResolvedValue({ id: 'PROV-1', status: 'payin_pending', data: {} });

      await runExpire();

      expect(provider.getTransactionStatus).toHaveBeenCalledWith('PROV-1');
      expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('direct charge refusé + lien hébergé au-delà de la fenêtre : expirée normalement', async () => {
      orderModel.find.mockResolvedValue([order]);
      orderModel.findOneAndUpdate.mockResolvedValue({ ...order, orderStatus: 'payment_failed' });
      setExistingPayment(makeStoredPayment({
        directChargeOutcome: 'refused',
        providerRef: 'PROV-1',
        paymentLink: VALID_LINK,
        createdAt: new Date(Date.now() - 90 * 60 * 1000),
      }));
      provider.getTransactionStatus.mockResolvedValue({ id: 'PROV-1', status: 'payin_pending', data: {} });

      await runExpire();

      expect(orderModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('flux hébergé POST /payments/initiate (B7)', () => {
    it('ServiceUnavailable : Payment conservé (jamais supprimé), outcome unknown, 409 PAYMENT_OUTCOME_UNKNOWN', async () => {
      provider.initiatePayment.mockRejectedValue(new ServiceUnavailableException('indisponible'));

      const error = await captureError(service.initiate(String(ORDER_ID), clientActor));

      expect(paymentModel.deleteOne).not.toHaveBeenCalled();
      expect(error.getStatus()).toBe(409);
      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ directChargeOutcome: 'unknown' }) }),
      );
    });

    it('autre erreur provider : Payment passé en FAILED (comportement inchangé)', async () => {
      provider.initiatePayment.mockRejectedValue(new BadRequestException('invalid'));

      await expect(service.initiate(String(ORDER_ID), clientActor)).rejects.toBeInstanceOf(BadRequestException);
      expect(paymentModel.deleteOne).not.toHaveBeenCalled();
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
      );
    });

    it('Payment direct PROCESSING existant : 409 PAYMENT_IN_PROGRESS, pas de lien hébergé ni appel provider', async () => {
      setExistingPayment(makeStoredPayment({ directChargeOutcome: 'prompt_sent', providerRef: 'PROV-1' }));

      const error = await captureError(service.initiate(String(ORDER_ID), clientActor));

      expect(error.getStatus()).toBe(409);
      expect(errorCode(error)).toBe('PAYMENT_IN_PROGRESS');
      expect(provider.getTransactionStatus).not.toHaveBeenCalled();
      expect(provider.initiatePayment).not.toHaveBeenCalled();
      expect(paymentModel.create).not.toHaveBeenCalled();
    });
  });

  describe('durcissement — item 1 : issues inconnues sur le flux hébergé', () => {
    it('hosted unknown ancien : 409 PAYMENT_OUTCOME_UNKNOWN, aucune libération, aucun appel provider', async () => {
      setExistingPayment(makeStoredPayment({
        paymentMethod: undefined,
        directChargeOutcome: 'unknown',
        providerRef: undefined,
        paymentLink: undefined,
        initiatedAt: new Date(Date.now() - 10 * 60 * 1000),
      }));

      const error = await captureError(service.initiate(String(ORDER_ID), clientActor));

      expect(error.getStatus()).toBe(409);
      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(provider.initiatePayment).not.toHaveBeenCalled();
      expect(paymentModel.create).not.toHaveBeenCalled();
    });

    it('hosted unknown récent : même réponse, jamais libéré', async () => {
      setExistingPayment(makeStoredPayment({
        paymentMethod: undefined,
        directChargeOutcome: 'unknown',
        providerRef: undefined,
        paymentLink: undefined,
        initiatedAt: new Date(),
      }));

      const error = await captureError(service.initiate(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('hosted calling récent : 409 PAYMENT_IN_PROGRESS, aucune libération', async () => {
      setExistingPayment(makeStoredPayment({
        paymentMethod: undefined,
        directChargeOutcome: 'calling',
        providerRef: undefined,
        paymentLink: undefined,
        initiatedAt: new Date(),
      }));

      const error = await captureError(service.initiate(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_IN_PROGRESS');
      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(provider.initiatePayment).not.toHaveBeenCalled();
    });

    it('hosted calling ancien : 409 PAYMENT_OUTCOME_UNKNOWN, marqué unknown, jamais libéré', async () => {
      setExistingPayment(makeStoredPayment({
        paymentMethod: undefined,
        directChargeOutcome: 'calling',
        providerRef: undefined,
        paymentLink: undefined,
        initiatedAt: new Date(Date.now() - 10 * 60 * 1000),
      }));

      const error = await captureError(service.initiate(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ directChargeOutcome: 'unknown' }) }),
      );
      expect(provider.initiatePayment).not.toHaveBeenCalled();
    });

    it('hosted sans issue directe au verrou périmé : libéré comme avant, filtre excluant unknown/calling', async () => {
      setExistingPayment(makeStoredPayment({
        paymentMethod: undefined,
        directChargeOutcome: undefined,
        providerRef: undefined,
        paymentLink: undefined,
        initiatedAt: new Date(Date.now() - 10 * 60 * 1000),
      }));
      paymentModel.findOneAndUpdate.mockResolvedValue({ _id: 'released' });
      provider.initiatePayment.mockResolvedValue({
        providerRef: 'HOSTED-1',
        transactionRef: 'IN-H',
        paymentLink: VALID_LINK,
        paymentWithTaxes: 4410,
        invoiceTaxes: 210,
      });

      const result = await service.initiate(String(ORDER_ID), clientActor);

      expect(paymentModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ directChargeOutcome: { $nin: ['unknown', 'calling'] } }),
        expect.anything(),
        expect.anything(),
      );
      expect(paymentModel.create).toHaveBeenCalledTimes(1);
      expect(result.checkout.paymentLink).toBe(VALID_LINK);
    });
  });

  describe('durcissement — items 2, 11 : expiration et journalisation', () => {
    it('prompt_sent encore PROCESSING : commande jamais expirée, la synchronisation tranche', async () => {
      orderModel.find.mockResolvedValue([order]);
      setExistingPayment(makeStoredPayment({ directChargeOutcome: 'prompt_sent', providerRef: 'PROV-1', status: 'processing' }));

      await (service as any).expireStalePendingOrders();

      expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('prompt_sent passé en FAILED par la synchronisation : expiration normale', async () => {
      orderModel.find.mockResolvedValue([order]);
      orderModel.findOneAndUpdate.mockResolvedValue({ ...order, orderStatus: 'payment_failed' });
      setExistingPayment(makeStoredPayment({ directChargeOutcome: 'prompt_sent', providerRef: undefined, status: 'failed' }));

      await (service as any).expireStalePendingOrders();

      expect(orderModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('journalisation : aucun warn par commande, un seul debug agrégé par passage', async () => {
      orderModel.find.mockResolvedValue([order, makeOrder({ _id: new Types.ObjectId() })]);
      setExistingPayment(makeStoredPayment({ directChargeOutcome: 'unknown' }));
      const warn = jest.spyOn((service as any).logger, 'warn');
      const debug = jest.spyOn((service as any).logger, 'debug');

      await (service as any).expireStalePendingOrders();

      expect(warn).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug.mock.calls[0][0]).toContain('2');
    });
  });

  describe('durcissement — items 2, 3, 4, 12 : relance directe sans nouvelle demande', () => {
    it.each(['payin_error', 'payin_closed'])(
      'prompt_sent puis statut distant %s : clôturé en FAILED, nouvelle tentative autorisée',
      async (remoteStatus) => {
        provider.getTransactionStatusOrThrow.mockResolvedValue({ id: 'PROV-1', status: remoteStatus, data: {} });
        // L'échec confirmé remet la commande en PAYMENT_FAILED : la nouvelle tentative repasse par la réservation de stock.
        orderModel.findOneAndUpdate.mockResolvedValue({ orderStatus: 'payment_failed', paymentStatus: 'failed' });
        paymentModel.findOneAndUpdate.mockResolvedValue({
          status: 'failed',
          callbackPayload: { status: remoteStatus },
          completedAt: new Date(),
        });
        const existing = makeStoredPayment({ directChargeOutcome: 'prompt_sent', providerRef: 'PROV-1' });
        setExistingPayment(existing);
        provider.initiateDirectCharge.mockResolvedValue(acceptedResult);

        const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

        expect(existing.status).toBe('failed');
        expect(paymentModel.findOneAndUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ _id: existing._id }),
          expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
          expect.objectContaining({ new: true }),
        );
        expect(paymentModel.create).toHaveBeenCalledTimes(1);
        expect(provider.initiateDirectCharge).toHaveBeenCalledTimes(1);
        expect(result.outcome).toBe('prompt_sent');
      },
    );

    it('statut distant inconnu (payin_refunded) : PAYMENT_OUTCOME_UNKNOWN, aucune nouvelle demande', async () => {
      provider.getTransactionStatusOrThrow.mockResolvedValue({ id: 'PROV-1', status: 'payin_refunded', data: {} });
      setExistingPayment(makeStoredPayment({ directChargeOutcome: 'prompt_sent', providerRef: 'PROV-1' }));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('vérification fournisseur en échec (timeout) : PAYMENT_OUTCOME_UNKNOWN, jamais de nouvelle demande ni d’échec', async () => {
      provider.getTransactionStatusOrThrow.mockRejectedValue(new DigikuntzDirectChargeError('unknown'));
      const existing = makeStoredPayment({ directChargeOutcome: 'prompt_sent', providerRef: 'PROV-1' });
      setExistingPayment(existing);

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(error.getStatus()).toBe(409);
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
      expect(existing.status).toBe('processing');
      expect(paymentModel.deleteOne).not.toHaveBeenCalled();
    });

    it('audit : refusalReason transmis, sans téléphone', async () => {
      provider.initiateDirectCharge.mockResolvedValue(refusedResult);

      await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      const audit = auditLogs.record.mock.calls.find(([input]) => input.action === 'payment.initiate_direct')[0];
      expect(audit.metadata.refusalReason).toBe('DIRECT_CHARGE_REFUSED');
      expect(audit.metadata.outcome).toBe('refused');
      expect(JSON.stringify(auditLogs.record.mock.calls)).not.toContain(ORANGE_PHONE);
    });
  });

  describe('durcissement — item 9 : format de l’identifiant de commande', () => {
    it.each(['not-an-id', '123', '665d58e63d7bfeb8f7f6172g'])(
      'initiate-direct avec identifiant %s : 400, aucune requête base',
      async (badId) => {
        const error = await captureError(service.initiateDirectPayment(badId, clientActor));

        expect(error.getStatus()).toBe(400);
        expect(orderModel.findById).not.toHaveBeenCalled();
      },
    );

    it('statut de paiement avec identifiant invalide : 400, aucune requête base', async () => {
      const error = await captureError(service.paymentStatus('not-an-id', clientActor));

      expect(error.getStatus()).toBe(400);
      expect(orderModel.findById).not.toHaveBeenCalled();
    });
  });

  describe('durcissement — item 5 : relance après échec avec réservation de stock', () => {
    const itemA = new Types.ObjectId();
    const itemB = new Types.ObjectId();

    function failedOrder(overrides: Record<string, any> = {}) {
      return makeOrder({
        orderStatus: 'payment_failed',
        paymentStatus: 'failed',
        items: [
          { menuItemId: itemA, name: 'Poulet DG', quantity: 2 },
          { menuItemId: itemB, name: 'Frites', quantity: 1 },
        ],
        ...overrides,
      });
    }

    it('commande PAYMENT_FAILED avec stock disponible : autorisé, stock décrémenté une fois par article, commande repassée en attente', async () => {
      order = failedOrder();
      orderModel.findById.mockResolvedValue(order);
      orderModel.findOneAndUpdate.mockResolvedValue({ orderStatus: 'pending_payment', paymentStatus: 'pending' });
      provider.initiateDirectCharge.mockResolvedValue(acceptedResult);

      const result = await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(result.outcome).toBe('prompt_sent');
      expect(inventory.adjustStock.mock.calls).toEqual([
        [itemA, -2, session],
        [itemB, -1, session],
      ]);
      expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: order._id, orderStatus: 'payment_failed' }),
        expect.objectContaining({ $set: expect.objectContaining({ orderStatus: 'pending_payment' }) }),
        expect.anything(),
      );
      expect(paymentModel.create).toHaveBeenCalledTimes(1);
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
    });

    it('commande PAYMENT_FAILED avec stock insuffisant sur un article : 409 INSUFFICIENT_STOCK, aucune création, transaction annulée', async () => {
      order = failedOrder();
      orderModel.findById.mockResolvedValue(order);
      inventory.adjustStock
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new BadRequestException(`Insufficient stock for menu item ${itemB}`));

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(error.getStatus()).toBe(409);
      expect((error.getResponse() as any).code).toBe('INSUFFICIENT_STOCK');
      expect((error.getResponse() as any).items[0].menuItemId).toBe(String(itemB));
      expect((error.getResponse() as any).message).toContain('Frites');
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
      expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
      // Aucune restitution manuelle : la transaction Mongo annule les décréments déjà faits.
      expect(inventory.adjustStock.mock.calls.every(([, delta]) => delta < 0)).toBe(true);
    });

    it('course : transition concurrente perdue : 409 PAYMENT_IN_PROGRESS, aucune création', async () => {
      order = failedOrder();
      orderModel.findById.mockResolvedValue(order);
      orderModel.findOneAndUpdate.mockResolvedValue(null);

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(errorCode(error)).toBe('PAYMENT_IN_PROGRESS');
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(provider.initiateDirectCharge).not.toHaveBeenCalled();
    });

    it('commande PENDING_PAYMENT : comportement inchangé, aucune réservation supplémentaire', async () => {
      provider.initiateDirectCharge.mockResolvedValue(acceptedResult);

      await service.initiateDirectPayment(String(ORDER_ID), clientActor);

      expect(inventory.adjustStock).not.toHaveBeenCalled();
      expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(paymentModel.create).toHaveBeenCalledTimes(1);
    });

    it.each(['cancelled', 'delivered'])('commande %s : refusée, aucune création, aucune réservation', async (status) => {
      order = failedOrder({ orderStatus: status });
      orderModel.findById.mockResolvedValue(order);

      const error = await captureError(service.initiateDirectPayment(String(ORDER_ID), clientActor));

      expect(error.getStatus()).toBe(400);
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(inventory.adjustStock).not.toHaveBeenCalled();
    });
  });

  describe('durcissement — item 7 : projection client du statut', () => {
    it('GET statut : ni callbackPayload, ni providerRef, ni transactionRef ; lien invalide masqué', async () => {
      setExistingPayment(makeStoredPayment({
        status: 'failed',
        providerRef: 'PROV-SECRET',
        transactionRef: 'IN-SECRET',
        callbackPayload: { error: 'SECRET-BODY', phone: ORANGE_PHONE },
        paymentLink: EVIL_LINK,
        directChargeOutcome: 'rejected',
        completedAt: new Date(),
      }));

      const view = await service.paymentStatus(String(ORDER_ID), clientActor);

      expect(view).not.toHaveProperty('callbackPayload');
      expect(view).not.toHaveProperty('providerRef');
      expect(view).not.toHaveProperty('transactionRef');
      expect(JSON.stringify(view)).not.toMatch(/SECRET|655000000|evil\.example/);
      expect(view).toEqual(expect.objectContaining({ status: 'failed', outcome: 'rejected', operator: 'ORANGEMONEY', paymentLink: null }));
    });

    it('lien valide conservé dans la projection', async () => {
      setExistingPayment(makeStoredPayment({ paymentLink: VALID_LINK, directChargeOutcome: 'refused' }));

      const view = await service.paymentStatus(String(ORDER_ID), clientActor);

      expect(view.paymentLink).toBe(VALID_LINK);
    });
  });

  describe('applyPayinStatus — atomicité et effets de bord', () => {
    let credit: jest.SpyInstance;
    let notifyRestaurant: jest.SpyInstance;

    beforeEach(() => {
      credit = jest.spyOn(service as any, 'creditOrderBalances').mockResolvedValue(undefined);
      notifyRestaurant = jest
        .spyOn(service as any, 'notifyRestaurantStaffOrderConfirmed')
        .mockResolvedValue(undefined);
      (service as any).notifications = { sendOrderConfirmed: jest.fn().mockResolvedValue(undefined) };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('succès concurrent : un seul claim applique le crédit et les notifications', async () => {
      const payment = makeStoredPayment({ status: 'processing' });
      const order = makeOrder();

      // 1er appelant : gagne le claim.
      paymentModel.findOneAndUpdate.mockResolvedValueOnce({
        status: 'paid',
        callbackPayload: { status: 'payin_success' },
        completedAt: new Date(),
      });
      orderModel.findById.mockResolvedValue({ ...order, paymentStatus: 'pending', orderStatus: 'pending_payment' });
      orderModel.findOneAndUpdate.mockResolvedValueOnce({
        ...order,
        paymentStatus: 'paid',
        orderStatus: 'paid',
        paymentConfirmedAt: new Date(),
      });

      await (service as any).applyPayinStatus(payment, order, 'transaction_payin_success', {
        status: 'transaction_payin_success',
      });

      expect(payment.status).toBe('paid');
      expect(credit).toHaveBeenCalledTimes(1);
      expect(notifyRestaurant).toHaveBeenCalledTimes(1);
      // Le paiement canonique est figé sur la commande : la réconciliation
      // ne pourra pas créditer une seconde tentative.
      expect(orderModel.findOneAndUpdate.mock.calls[0][1].$set.paidPaymentId).toBe(payment._id);

      // 2e appelant (webhook/cron concurrent) : claim perdu → aucun nouvel effet.
      paymentModel.findOneAndUpdate.mockResolvedValueOnce(null);
      paymentModel.findById.mockResolvedValue({
        status: 'paid',
        callbackPayload: { status: 'payin_success' },
        completedAt: new Date(),
      });

      await (service as any).applyPayinStatus(payment, order, 'payin_success', { status: 'payin_success' });

      expect(credit).toHaveBeenCalledTimes(1);
      expect(notifyRestaurant).toHaveBeenCalledTimes(1);
      expect(orderModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('ensurePaidOrderBalances utilise le paiement canonique paidPaymentId', async () => {
      const driverId = new Types.ObjectId();
      const canonical = makeStoredPayment({ status: 'paid' });
      const order = makeOrder({
        paymentStatus: 'paid',
        paidPaymentId: canonical._id,
      });
      paymentModel.findOne.mockResolvedValueOnce(canonical);
      const creditSpy = jest
        .spyOn(service as any, 'creditOrderBalances')
        .mockResolvedValue(undefined);

      await service.ensurePaidOrderBalances(order, driverId);

      expect(paymentModel.findOne).toHaveBeenCalledWith({
        _id: canonical._id,
        status: 'paid',
      });
      expect(creditSpy).toHaveBeenCalledWith(order, canonical, driverId);
    });

    it('succès tardif après expiration : re-réserve le stock avant de créditer', async () => {
      const item = { menuItemId: new Types.ObjectId(), quantity: 2, name: 'Poulet DG' };
      const payment = makeStoredPayment({
        status: 'failed',
        callbackPayload: { reason: 'payment_timeout' },
      });
      const expiredOrder = makeOrder({
        orderStatus: 'payment_failed',
        paymentStatus: 'failed',
        items: [item],
      });

      orderModel.findById.mockResolvedValue(expiredOrder);
      paymentModel.findOneAndUpdate.mockResolvedValue({
        status: 'paid',
        callbackPayload: { status: 'payin_success' },
        completedAt: new Date(),
      });
      orderModel.findOneAndUpdate.mockResolvedValue({
        ...expiredOrder,
        paymentStatus: 'paid',
        orderStatus: 'paid',
      });

      await (service as any).applyPayinStatus(payment, expiredOrder, 'payin_success', {});

      expect(inventory.adjustStock).toHaveBeenCalledWith(item.menuItemId, -2, session);
      expect(credit).toHaveBeenCalledTimes(1);
      expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expiredOrder._id }),
        expect.objectContaining({
          $set: expect.objectContaining({ paymentStatus: 'paid', orderStatus: 'paid' }),
        }),
        expect.objectContaining({ new: true }),
      );
    });

    it('succès tardif sans stock : anomalie paid_without_stock, aucun crédit', async () => {
      const item = { menuItemId: new Types.ObjectId(), quantity: 2, name: 'Poulet DG' };
      const payment = makeStoredPayment({
        status: 'failed',
        callbackPayload: { reason: 'payment_timeout' },
      });
      const expiredOrder = makeOrder({
        orderStatus: 'payment_failed',
        paymentStatus: 'failed',
        items: [item],
      });

      inventory.adjustStock.mockRejectedValueOnce(new BadRequestException('Insufficient stock for menu item X'));
      orderModel.findById.mockResolvedValue(expiredOrder);
      paymentModel.findOneAndUpdate.mockResolvedValue({
        status: 'paid',
        callbackPayload: { status: 'payin_success' },
        completedAt: new Date(),
      });
      orderModel.findOneAndUpdate.mockResolvedValue({
        ...expiredOrder,
        paymentStatus: 'paid',
        paymentAnomaly: 'paid_without_stock',
      });

      await (service as any).applyPayinStatus(payment, expiredOrder, 'payin_success', {});

      expect(credit).not.toHaveBeenCalled();
      expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expiredOrder._id }),
        expect.objectContaining({
          $set: expect.objectContaining({ paymentAnomaly: 'paid_without_stock' }),
        }),
        expect.objectContaining({ new: true }),
      );
    });

    it('échec concurrent : une seule restitution de stock', async () => {
      const payment = makeStoredPayment({ status: 'processing' });
      const order = makeOrder();
      const restore = jest
        .spyOn(service as any, 'restoreReservedStockIfCurrentCameroonDay')
        .mockResolvedValue({ restored: true });

      paymentModel.findOneAndUpdate.mockResolvedValueOnce({
        status: 'failed',
        callbackPayload: { status: 'payin_error' },
        completedAt: new Date(),
      });
      orderModel.findById.mockResolvedValue({ ...order, paymentStatus: 'pending', orderStatus: 'pending_payment' });
      orderModel.findOneAndUpdate.mockResolvedValueOnce({
        ...order,
        paymentStatus: 'failed',
        orderStatus: 'payment_failed',
      });

      await (service as any).applyPayinStatus(payment, order, 'payin_error', { status: 'payin_error' });
      expect(restore).toHaveBeenCalledTimes(1);

      paymentModel.findOneAndUpdate.mockResolvedValueOnce(null);
      paymentModel.findById.mockResolvedValue({
        status: 'failed',
        callbackPayload: { status: 'payin_error' },
        completedAt: new Date(),
      });

      await (service as any).applyPayinStatus(payment, order, 'payin_error', { status: 'payin_error' });
      expect(restore).toHaveBeenCalledTimes(1);
    });
  });

  describe('creditOrderBalances — idempotence par commande', () => {
    const driverId = new Types.ObjectId();
    const otherDriverId = new Types.ObjectId();

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function v3Order(overrides: Record<string, any> = {}) {
      return makeOrder({
        restaurantId: RESTAURANT_ID,
        pricingSnapshot: {
          itemsSubtotal: 5000,
          packagingTotal: 400,
          deliveryFee: 1500,
          categorySystemFeeTotal: 300,
          promoDiscount: 0,
          platformFee: 345,
          paymentAmount: 7245,
          grandTotal: 7245,
          balanceDistributionVersion: 3,
        },
        ...overrides,
      });
    }

    function mockExisting(rows: any[]) {
      const lean = jest.fn().mockResolvedValue(rows);
      const select = jest.fn().mockReturnValue({ lean });
      const find = jest.fn().mockReturnValue({ select });
      (service as any).transactionModel = { find };
      return { find, select, lean };
    }

    it('ne crédite que les parts absentes (idempotence par commande)', async () => {
      mockExisting([
        { reason: 'order_system_share', userId: null },
        { reason: 'order_restaurant_share', userId: null },
      ]);
      const record = jest
        .spyOn(service as any, 'recordOrderBalanceTransaction')
        .mockResolvedValue(true);
      const order = v3Order();

      const inserted = await (service as any).creditOrderBalances(
        order,
        makeStoredPayment({ status: 'paid' }),
        driverId,
      );

      expect(inserted).toBe(1);
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0][0]).toMatchObject({
        reason: 'order_delivery_share',
        ownerType: 'user',
      });
      expect(orderModel.updateOne).toHaveBeenCalledWith(
        { _id: order._id },
        { $set: { driverShareSettledAt: expect.any(Date) } },
        { session },
      );
    });

    it('refuse une répartition v3 qui ne couvre pas le montant encaissé', async () => {
      mockExisting([]);
      const record = jest
        .spyOn(service as any, 'recordOrderBalanceTransaction')
        .mockResolvedValue(true);
      const order = makeOrder({
        pricingSnapshot: {
          deliveryFee: 0,
          categorySystemFeeTotal: 0,
          promoDiscount: 0,
          platformFee: 0,
          paymentAmount: 4200,
          balanceDistributionVersion: 3,
        },
      });

      const inserted = await (service as any).creditOrderBalances(
        order,
        makeStoredPayment({ status: 'paid' }),
        driverId,
      );

      expect(inserted).toBe(0);
      expect(record).not.toHaveBeenCalled();
      // La commande est marquée pour sortir des crons de reprise.
      expect(orderModel.updateOne).toHaveBeenCalledWith(
        { _id: order._id, settlementError: null },
        {
          $set: {
            settlementError: 'inconsistent_distribution',
            driverShareSettledAt: expect.any(Date),
          },
        },
      );
    });

    it('ne paie pas une seconde fois un livreur différent et signale l’anomalie', async () => {
      mockExisting([
        { reason: 'order_system_share', userId: null },
        { reason: 'order_restaurant_share', userId: null },
        { reason: 'order_delivery_share', userId: otherDriverId },
      ]);
      const record = jest
        .spyOn(service as any, 'recordOrderBalanceTransaction')
        .mockResolvedValue(true);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const order = v3Order();

      const inserted = await (service as any).creditOrderBalances(
        order,
        makeStoredPayment({ status: 'paid' }),
        driverId,
      );

      expect(inserted).toBe(0);
      expect(record).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('another driver'));
      expect(orderModel.updateOne).toHaveBeenCalled();
    });
  });

  describe('crons de réconciliation', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('reconcilePaidOrderBalances ne crédite qu’une fois par commande', async () => {
      (service as any).cronLease = { acquire: jest.fn().mockResolvedValue(true) };
      const first = makeStoredPayment({ status: 'paid' });
      const second = makeStoredPayment({ status: 'paid' });
      const limit = jest.fn().mockResolvedValue([first, second]);
      const sort = jest.fn().mockReturnValue({ limit });
      paymentModel.find.mockReturnValue({ sort });

      const canonical = makeStoredPayment({ status: 'paid' });
      paymentModel.findOne.mockResolvedValueOnce(canonical);
      const order = makeOrder({
        paymentStatus: 'paid',
        paidPaymentId: canonical._id,
      });
      orderModel.findById.mockResolvedValue(order);
      const credit = jest
        .spyOn(service as any, 'creditOrderBalances')
        .mockResolvedValue(1);

      await service.reconcilePaidOrderBalances();

      expect(credit).toHaveBeenCalledTimes(1);
      expect(credit).toHaveBeenCalledWith(order, canonical, undefined);
    });

    it('le cron livreur ne prend que les commandes non réglées, de la plus ancienne à la plus récente', async () => {
      (service as any).cronLease = { acquire: jest.fn().mockResolvedValue(true) };
      const select = jest.fn().mockResolvedValue([]);
      const limit = jest.fn().mockReturnValue({ select });
      const sort = jest.fn().mockReturnValue({ limit });
      orderModel.find.mockReturnValue({ sort });

      await service.reconcileDeliveredDriverBalances();

      expect(orderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          driverShareSettledAt: null,
          settlementError: null,
        }),
      );
      expect(sort).toHaveBeenCalledWith({ updatedAt: 1 });
      expect(limit).toHaveBeenCalledWith(200);
    });
  });
});
