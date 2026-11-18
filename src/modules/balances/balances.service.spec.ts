import { Types } from 'mongoose';
import { BalancesService } from './balances.service';

describe('BalancesService — backfill des soldes', () => {
  const restaurantId = new Types.ObjectId();
  const driverId = new Types.ObjectId();

  let balanceModel: { updateOne: jest.Mock };
  let transactionModel: { aggregate: jest.Mock };
  let cronLease: { acquire: jest.Mock };
  let service: BalancesService;

  beforeEach(() => {
    balanceModel = { updateOne: jest.fn().mockResolvedValue({}) };
    transactionModel = { aggregate: jest.fn() };
    cronLease = { acquire: jest.fn().mockResolvedValue(true) };

    service = new BalancesService(
      balanceModel as any,
      transactionModel as any,
      { collection: { name: 'withdrawalrequests' } } as any, // withdrawalModel
      {} as any, // userModel
      {} as any, // restaurantModel
      {} as any, // orderModel
      {} as any, // paymentModel
      {} as any, // connection
      {} as any, // digikuntzProvider
      {} as any, // notifications
      cronLease as any,
      {} as any, // auditLogs
    );
  });

  it('additionne toutes les lignes système au lieu d’écraser le solde par sous-groupe', async () => {
    transactionModel.aggregate.mockResolvedValue([
      // Part système « commandes » (sans userId/restaurantId)
      {
        _id: { ownerType: 'system', restaurantId: null, userId: null },
        balance: 5000,
        currency: 'XAF',
      },
      // Débit système d'un financement livreur (porte un userId)
      {
        _id: { ownerType: 'system', restaurantId: null, userId: driverId },
        balance: -1000,
        currency: 'XAF',
      },
      // Débit système d'un financement restaurant (porte un restaurantId)
      {
        _id: { ownerType: 'system', restaurantId, userId: null },
        balance: -250,
        currency: 'XAF',
      },
      // Compte restaurant indépendant
      {
        _id: { ownerType: 'restaurant', restaurantId, userId: null },
        balance: 3000,
        currency: 'XAF',
      },
    ]);

    await service.backfillBalancesFromTransactions();

    expect(cronLease.acquire).toHaveBeenCalledWith('balances.backfill', 4 * 60 * 1000);
    expect(balanceModel.updateOne).toHaveBeenCalledTimes(2);

    const systemCall = balanceModel.updateOne.mock.calls.find(
      ([filter]: any[]) => filter.accountType === 'system',
    );
    expect(systemCall?.[0]).toEqual({ accountType: 'system', ownerId: '0000000' });
    expect(systemCall?.[1].$set.balance).toBe(3750); // 5000 − 1000 − 250

    const restaurantCall = balanceModel.updateOne.mock.calls.find(
      ([filter]: any[]) => filter.accountType === 'restaurant',
    );
    expect(restaurantCall?.[0]).toEqual({
      accountType: 'restaurant',
      ownerId: String(restaurantId),
    });
    expect(restaurantCall?.[1].$set.balance).toBe(3000);
  });

  it('ne réécrit rien si le lease de réconciliation est déjà pris', async () => {
    cronLease.acquire.mockResolvedValue(false);

    await service.backfillBalancesFromTransactions();

    expect(transactionModel.aggregate).not.toHaveBeenCalled();
    expect(balanceModel.updateOne).not.toHaveBeenCalled();
  });
});