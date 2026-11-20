import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { BalancesService } from './balances.service';

describe('BalancesService — retrait automatique restaurant', () => {
  const restaurantId = new Types.ObjectId();
  const managerId = new Types.ObjectId();

  let restaurantModel: { find: jest.Mock };
  let userModel: { findById: jest.Mock };
  let withdrawalModel: { exists: jest.Mock; collection: { name: string } };
  let cronLease: { acquire: jest.Mock };
  let service: BalancesService;
  let created: jest.SpyInstance;
  let balance: jest.SpyInstance;

  const restaurant = {
    _id: restaurantId,
    name: 'Chez Maman',
    status: 'active',
    managerId,
    autoWithdrawal: {
      enabled: true,
      phone: '691224472',
      accountBankCode: 'ORANGEMONEY',
    },
  };

  beforeEach(() => {
    restaurantModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([restaurant]),
          }),
        }),
      }),
    };
    userModel = {
      findById: jest.fn().mockResolvedValue({
        _id: managerId,
        email: 'manager@example.com',
        isActive: true,
      }),
    };
    withdrawalModel = {
      exists: jest.fn().mockResolvedValue(null),
      collection: { name: 'withdrawalrequests' },
    };
    cronLease = { acquire: jest.fn().mockResolvedValue(true) };

    service = new BalancesService(
      {} as any, // balanceModel
      {} as any, // transactionModel
      withdrawalModel as any,
      userModel as any,
      restaurantModel as any,
      {} as any, // orderModel
      {} as any, // paymentModel
      {} as any, // connection
      {} as any, // digikuntzProvider
      {} as any, // notifications
      cronLease as any,
      {} as any, // auditLogs
    );

    balance = jest.spyOn(service as any, 'balanceFor').mockResolvedValue(1500);
    created = jest
      .spyOn(service as any, 'createWithdrawal')
      .mockResolvedValue({ withdrawal: { _id: new Types.ObjectId() } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MIN_WITHDRAWAL_AMOUNT_XAF;
  });

  it('retire la totalité du solde si > minimum', async () => {
    process.env.MIN_WITHDRAWAL_AMOUNT_XAF = '1000';

    await service.runRestaurantAutoWithdrawals();

    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: String(managerId),
        role: UserRole.MANAGER,
        restaurantId: String(restaurantId),
      }),
      expect.objectContaining({
        amount: 1500,
        phone: '691224472',
        accountBankCode: 'ORANGEMONEY',
      }),
    );
    expect((created.mock.calls[0][1] as any).idempotencyKey).toMatch(
      new RegExp(`^auto-${restaurantId}-`),
    );
  });

  it('ne retire pas si le solde est égal au minimum (strictement supérieur requis)', async () => {
    process.env.MIN_WITHDRAWAL_AMOUNT_XAF = '1500';

    await service.runRestaurantAutoWithdrawals();

    expect(created).not.toHaveBeenCalled();
  });

  it('ne crée pas un second retrait si un retrait est déjà en attente', async () => {
    withdrawalModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await service.runRestaurantAutoWithdrawals();

    expect(created).not.toHaveBeenCalled();
  });

  it('ignore un numéro qui ne correspond pas au réseau configuré', async () => {
    restaurantModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              ...restaurant,
              autoWithdrawal: {
                enabled: true,
                phone: '670123456',
                accountBankCode: 'ORANGEMONEY',
              },
            },
          ]),
        }),
      }),
    });

    await service.runRestaurantAutoWithdrawals();

    expect(created).not.toHaveBeenCalled();
    expect(balance).not.toHaveBeenCalled();
  });
});