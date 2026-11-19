import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { BalancesService } from './balances.service';

describe('BalancesService — retraits sécurisés', () => {
  const driverId = new Types.ObjectId();
  const actor = { sub: String(driverId), email: 'driver@example.com', role: UserRole.DRIVER };

  let withdrawalModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    findById: jest.Mock;
    find: jest.Mock;
    updateOne: jest.Mock;
    countDocuments: jest.Mock;
  };
  let userModel: { findById: jest.Mock };
  let connection: { startSession: jest.Mock };
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };
  let service: BalancesService;
  let auditLogs: { record: jest.Mock };
  let transition: jest.SpyInstance;
  let callPayout: jest.SpyInstance;
  let recordDebit: jest.SpyInstance;

  function makeWithdrawal(overrides: Record<string, any> = {}): any {
    return {
      _id: new Types.ObjectId(),
      ownerType: 'user',
      userId: driverId,
      requestedBy: driverId,
      amount: 1000,
      phone: '670123456',
      accountBankCode: 'MTN',
      currency: 'XAF',
      status: 'pending',
      ...overrides,
    };
  }

  beforeEach(() => {
    withdrawalModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    userModel = {
      findById: jest.fn().mockResolvedValue({
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'driver@example.com',
      }),
    };
    session = {
      withTransaction: jest.fn(async (fn: any) => fn(session)),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    auditLogs = { record: jest.fn() };

    service = new BalancesService(
      {} as any, // balanceModel
      {} as any, // transactionModel
      withdrawalModel as any,
      userModel as any,
      {} as any, // restaurantModel
      {} as any, // orderModel
      {} as any, // paymentModel
      connection as any,
      {} as any, // digikuntzProvider
      {} as any, // notifications
      {} as any, // cronLease
      auditLogs as any,
    );

    jest.spyOn(service as any, 'balanceFor').mockResolvedValue(10_000);
    jest.spyOn(service as any, 'refreshCachedBalance').mockResolvedValue(9_000);
    recordDebit = jest
      .spyOn(service as any, 'recordBalanceTransaction')
      .mockResolvedValue({ _id: new Types.ObjectId() });

    transition = jest
      .spyOn(service as any, 'transitionWithdrawalStatus')
      .mockImplementation(async (_id: string, status: string, _note?: string, _by?: string, fields?: any) => ({
        withdrawal: { ...makeWithdrawal(), status, ...(fields || {}) },
        balance: 9_000,
        refunded: status === 'failed',
      }));

    callPayout = jest
      .spyOn(service as any, 'callDigikuntzPayoutOutcome')
      .mockResolvedValue({
        kind: 'success',
        providerRef: 'PROV-1',
        transactionRef: 'TX-1',
        providerStatus: 'payout_pending',
        providerPayload: { status: 'payout_pending' },
      });

    withdrawalModel.create.mockImplementation(async (docs: any[]) =>
      docs.map((doc) => ({ ...doc, save: jest.fn() })),
    );

    // Par défaut : aucune clé existante et aucun doublon récent.
    withdrawalModel.findOne.mockImplementation((filter: any) => {
      if (filter?.idempotencyKey) return Promise.resolve(null);
      return { sort: jest.fn().mockResolvedValue(null) };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persiste le retrait et débite le solde AVANT l’appel provider', async () => {
    const order: string[] = [];
    withdrawalModel.create.mockImplementation(async (docs: any[]) => {
      order.push('db');
      return docs.map((doc) => ({ ...doc, save: jest.fn() }));
    });
    callPayout.mockImplementation(async () => {
      order.push('provider');
      return {
        kind: 'success',
        providerRef: 'PROV-1',
        transactionRef: 'TX-1',
        providerStatus: 'payout_pending',
        providerPayload: {},
      };
    });

    const result = await service.createWithdrawal(actor, {
      amount: 1000,
      phone: '670123456',
      idempotencyKey: 'withdraw-1',
    });

    expect(order).toEqual(['db', 'provider']);
    expect(recordDebit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -1000, reason: 'withdrawal_request' }),
      session,
    );
    expect(transition).toHaveBeenCalledWith(
      expect.any(String),
      'pending',
      undefined,
      actor.sub,
      expect.objectContaining({ providerRef: 'PROV-1' }),
    );
    expect(result.withdrawal.status).toBe('pending');
  });

  it('rejoue un retrait existant avec la même clé sans rappeler le provider', async () => {
    const existing = makeWithdrawal({ status: 'pending', idempotencyKey: 'withdraw-1' });
    withdrawalModel.findOne.mockResolvedValueOnce(existing);

    const result: any = await service.createWithdrawal(actor, {
      amount: 1000,
      phone: '670123456',
      idempotencyKey: 'withdraw-1',
    });

    expect(callPayout).not.toHaveBeenCalled();
    expect(withdrawalModel.create).not.toHaveBeenCalled();
    expect(recordDebit).not.toHaveBeenCalled();
    expect(result.idempotentReplay).toBe(true);
    expect(result.replayReason).toBe('idempotent_replay');
  });

  it('sans clé client, renvoie le retrait identique encore non résolu', async () => {
    const recent = makeWithdrawal({ status: 'gateway_unavailable' });
    withdrawalModel.findOne.mockImplementation((filter: any) => {
      if (filter?.idempotencyKey) return Promise.resolve(null);
      return { sort: jest.fn().mockResolvedValue(recent) };
    });

    const result: any = await service.createWithdrawal(actor, {
      amount: 1000,
      phone: '670123456',
    });

    expect(callPayout).not.toHaveBeenCalled();
    expect(withdrawalModel.create).not.toHaveBeenCalled();
    expect(result.idempotentReplay).toBe(true);
    expect(result.replayReason).toBe('recent_duplicate');
  });

  it('génère une clé déterministe et refuse une clé réutilisée avec d’autres paramètres', async () => {
    await service.createWithdrawal(actor, {
      amount: 1000,
      phone: '670123456',
    });
    const createdDoc = withdrawalModel.create.mock.calls[0][0][0];
    expect(createdDoc.idempotencyKey).toMatch(/^svc:[0-9a-f]{64}$/);

    const existing = makeWithdrawal({
      idempotencyKey: 'withdraw-1',
      amount: 2000,
      phone: '670123456',
    });
    withdrawalModel.findOne.mockResolvedValueOnce(existing);

    await expect(
      service.createWithdrawal(actor, {
        amount: 1000,
        phone: '670123456',
        idempotencyKey: 'withdraw-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('un refus provider marque le retrait failed (refund) puis renvoie 400', async () => {
    callPayout.mockResolvedValue({
      kind: 'provider_error',
      providerMessage: 'Solde provider insuffisant',
      rawError: 'HTTP 400',
    });

    await expect(
      service.createWithdrawal(actor, {
        amount: 1000,
        phone: '670123456',
        idempotencyKey: 'withdraw-2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Le débit et le remboursement compensatoire sont bien tracés.
    expect(recordDebit).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      expect.any(String),
      'failed',
      'Solde provider insuffisant',
      actor.sub,
      expect.objectContaining({ providerStatus: 'payout_error' }),
      { notify: false },
    );
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ status: 'failed' }),
        statusCode: 400,
      }),
    );
  });

  it('un gateway indisponible conserve le débit et laisse le cron reprendre', async () => {
    callPayout.mockResolvedValue({ kind: 'gateway_unavailable', rawError: 'timeout' });

    const result = await service.createWithdrawal(actor, {
      amount: 1000,
      phone: '670123456',
      idempotencyKey: 'withdraw-3',
    });

    expect(result.withdrawal.status).toBe('gateway_unavailable');
    expect(transition).toHaveBeenCalledWith(
      expect.any(String),
      'gateway_unavailable',
      undefined,
      actor.sub,
      expect.objectContaining({
        lastGatewayRetryAt: expect.any(Date),
        gatewayUnavailableAttempts: 1,
      }),
    );
  });

  it('une course sur la clé renvoie le retrait gagnant au lieu d’un 500', async () => {
    const duplicate = makeWithdrawal({
      status: 'pending',
      idempotencyKey: 'withdraw-race',
    });
    withdrawalModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(duplicate);
    withdrawalModel.create.mockRejectedValueOnce({ code: 11000 });

    const result: any = await service.createWithdrawal(actor, {
      amount: 1000,
      phone: '670123456',
      idempotencyKey: 'withdraw-race',
    });

    expect(result.idempotentReplay).toBe(true);
    expect(result.withdrawal).toBe(duplicate);
  });

  it('un 409 d’idempotence garde le retrait en attente sans remboursement', async () => {
    callPayout.mockResolvedValue({
      kind: 'idempotency_in_progress',
      rawError: 'Request with this Idempotency-Key is still in progress',
    });

    const result: any = await service.createWithdrawal(actor, {
      amount: 1000,
      phone: '670123456',
      idempotencyKey: 'withdraw-409',
    });

    expect(result.withdrawal.status).toBe('gateway_unavailable');
    expect(transition).toHaveBeenCalledWith(
      expect.any(String),
      'gateway_unavailable',
      undefined,
      actor.sub,
      expect.objectContaining({
        providerStatus: 'idempotency_in_progress',
        nextGatewayRetryAt: expect.any(Date),
      }),
    );
    expect(
      transition.mock.calls.some(([, status]: any[]) => status === 'failed'),
    ).toBe(false);
  });

  it('un succès sans référence provider repasse en gateway_unavailable', async () => {
    callPayout.mockResolvedValue({
      kind: 'success',
      providerStatus: 'payout_pending',
      providerPayload: {},
    });

    const result: any = await service.createWithdrawal(actor, {
      amount: 1000,
      phone: '670123456',
      idempotencyKey: 'withdraw-no-ref',
    });

    expect(result.withdrawal.status).toBe('gateway_unavailable');
    expect(transition).toHaveBeenCalledWith(
      expect.any(String),
      'gateway_unavailable',
      undefined,
      actor.sub,
      expect.objectContaining({ providerStatus: 'missing_provider_reference' }),
    );
  });

  it('une transition ignorée renvoie 409 et n’audite pas comme appliquée', async () => {
    const admin = {
      sub: String(driverId),
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    };
    withdrawalModel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ status: 'paid' }),
    });
    transition.mockResolvedValueOnce({
      ignored: true,
      withdrawal: { status: 'paid' },
      refunded: false,
    });

    await expect(
      service.updateWithdrawalStatus(
        String(new Types.ObjectId()),
        { status: 'failed' } as any,
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          applied: false,
          requested: 'failed',
          effective: 'paid',
        }),
        statusCode: 409,
      }),
    );
  });

  it('le cron exclut les lignes clôturées et respecte le backoff', async () => {
    (service as any).cronLease = { acquire: jest.fn().mockResolvedValue(true) };
    const limit = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ limit });
    withdrawalModel.find.mockReturnValue({ sort });

    await service.retryGatewayUnavailableWithdrawals();

    expect(withdrawalModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'gateway_unavailable',
        providerStatus: { $nin: ['manual_reconciliation_required'] },
        $or: [
          { nextGatewayRetryAt: null },
          { nextGatewayRetryAt: { $lte: expect.any(Date) } },
        ],
      }),
    );
    expect(sort).toHaveBeenCalledWith({
      nextGatewayRetryAt: 1,
      gatewayUnavailableSince: 1,
    });
  });

  it('au TTL 24 h, vérifie le provider avant de clôturer', async () => {
    (service as any).cronLease = { acquire: jest.fn().mockResolvedValue(true) };
    const stale = makeWithdrawal({
      status: 'gateway_unavailable',
      transactionRef: 'TX-OLD',
      gatewayUnavailableSince: new Date(Date.now() - 25 * 60 * 60 * 1000),
      gatewayUnavailableAttempts: 3,
      lastGatewayRetryAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    withdrawalModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([stale]),
      }),
    });
    jest.spyOn(service as any, 'fetchProviderWithdrawalStatus').mockResolvedValue({
      id: 'PROV-OLD',
      status: 'payout_pending',
      data: { transactionRef: 'TX-OLD' },
    });

    await service.retryGatewayUnavailableWithdrawals();

    expect(transition).toHaveBeenCalledWith(
      String(stale._id),
      'pending',
      undefined,
      undefined,
      expect.objectContaining({ providerStatus: 'payout_pending' }),
    );
  });

  it('au TTL 24 h sans confirmation provider, arrête les retries et exige une réconciliation', async () => {
    (service as any).cronLease = { acquire: jest.fn().mockResolvedValue(true) };
    const stale = makeWithdrawal({
      status: 'gateway_unavailable',
      gatewayUnavailableSince: new Date(Date.now() - 25 * 60 * 60 * 1000),
      gatewayUnavailableAttempts: 3,
      lastGatewayRetryAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    withdrawalModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([stale]),
      }),
    });
    jest.spyOn(service as any, 'fetchProviderWithdrawalStatus').mockResolvedValue(null);
    const notify = jest
      .spyOn(service as any, 'notifyWithdrawalReconciliationRequired')
      .mockResolvedValue(undefined);

    await service.retryGatewayUnavailableWithdrawals();

    expect(transition).toHaveBeenCalledWith(
      String(stale._id),
      'gateway_unavailable',
      undefined,
      undefined,
      expect.objectContaining({
        providerStatus: 'manual_reconciliation_required',
        nextGatewayRetryAt: null,
      }),
    );
    expect(notify).toHaveBeenCalledWith(stale, 'idempotency_ttl_expired');
  });

  it('liste les retraits à réconcilier (providerStatus + lateProviderSuccessAt)', async () => {
    const limit = jest.fn().mockResolvedValue([]);
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    withdrawalModel.find.mockReturnValue({ sort });
    withdrawalModel.countDocuments.mockResolvedValue(0);

    await service.listWithdrawalsForReconciliation(1, 10);

    expect(withdrawalModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({ status: 'gateway_unavailable' }),
          { lateProviderSuccessAt: { $ne: null } },
        ]),
      }),
    );
    expect(sort).toHaveBeenCalledWith({ updatedAt: 1 });
  });

  it('au timeout, un payout finalement accepté est résolu au lieu d’être remboursé', async () => {
    (service as any).cronLease = { acquire: jest.fn().mockResolvedValue(true) };
    const stale = makeWithdrawal({
      status: 'gateway_unavailable',
      transactionRef: 'TX-1',
      gatewayUnavailableSince: new Date(Date.now() - 2 * 60 * 60 * 1000),
      gatewayUnavailableAttempts: 3,
      lastGatewayRetryAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    withdrawalModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([stale]),
      }),
    });
    const remote = {
      id: 'PROV-1',
      status: 'payout_pending',
      data: { transactionRef: 'TX-1' },
    };
    jest.spyOn(service as any, 'fetchProviderWithdrawalStatus').mockResolvedValue(remote);

    await service.retryGatewayUnavailableWithdrawals();

    expect(transition).toHaveBeenCalledWith(
      String(stale._id),
      'pending',
      undefined,
      undefined,
      expect.objectContaining({ providerStatus: 'payout_pending' }),
    );
  });

  it('au timeout sans confirmation provider, les fonds restent retenus (aucun remboursement à l’aveugle)', async () => {
    (service as any).cronLease = { acquire: jest.fn().mockResolvedValue(true) };
    const stale = makeWithdrawal({
      status: 'gateway_unavailable',
      gatewayUnavailableSince: new Date(Date.now() - 2 * 60 * 60 * 1000),
      gatewayUnavailableAttempts: 3,
      lastGatewayRetryAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    withdrawalModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([stale]),
      }),
    });
    jest.spyOn(service as any, 'fetchProviderWithdrawalStatus').mockResolvedValue(null);
    const notify = jest
      .spyOn(service as any, 'notifyWithdrawalReconciliationRequired')
      .mockResolvedValue(undefined);

    await service.retryGatewayUnavailableWithdrawals();

    expect(transition).toHaveBeenCalledWith(
      String(stale._id),
      'gateway_unavailable',
      undefined,
      undefined,
      expect.objectContaining({ providerStatus: 'unverified_timeout' }),
    );
    expect(notify).toHaveBeenCalledWith(stale, 'unverified_timeout');
    const failedTransition = transition.mock.calls.find(
      ([, status]: any[]) => status === 'failed',
    );
    expect(failedTransition).toBeUndefined();
  });

  it('un succès provider tardif après échec est signalé sans double transition', async () => {
    // Ce test exerce la vraie transition, pas le spy utilisé par les autres cas.
    transition.mockRestore();
    const notify = jest
      .spyOn(service as any, 'notifyWithdrawalReconciliationRequired')
      .mockResolvedValue(undefined);
    const failed = makeWithdrawal({
      status: 'failed',
      providerStatus: 'payout_error',
      lateProviderSuccessAt: null,
      save: jest.fn().mockResolvedValue(undefined),
    });
    withdrawalModel.findById.mockReturnValue({
      session: jest.fn().mockResolvedValue(failed),
    });

    const result = await (service as any).transitionWithdrawalStatus(
      String(failed._id),
      'paid',
      undefined,
      undefined,
      { providerStatus: 'payout_success', providerRef: 'PROV-1' },
    );

    expect(result.lateSuccess).toBe(true);
    expect(failed.status).toBe('failed');
    expect(failed.lateProviderSuccessAt).toBeInstanceOf(Date);
    expect(failed.save).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(failed, 'late_provider_success');
  });

  it('n’alerte pas une seconde fois un succès tardif déjà signalé', async () => {
    transition.mockRestore();
    const notify = jest
      .spyOn(service as any, 'notifyWithdrawalReconciliationRequired')
      .mockResolvedValue(undefined);
    const failed = makeWithdrawal({
      status: 'failed',
      lateProviderSuccessAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    });
    withdrawalModel.findById.mockReturnValue({
      session: jest.fn().mockResolvedValue(failed),
    });

    const result = await (service as any).transitionWithdrawalStatus(
      String(failed._id),
      'paid',
      undefined,
      undefined,
      { providerStatus: 'payout_success' },
    );

    expect(result.lateSuccess).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });
});