import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { RestaurantsService } from './restaurants.service';

describe('RestaurantsService — retrait automatique', () => {
  const restaurantId = new Types.ObjectId();
  const managerId = new Types.ObjectId();
  const actor = {
    sub: String(managerId),
    email: 'manager@example.com',
    role: UserRole.MANAGER,
    restaurantId: String(restaurantId),
  };

  let restaurant: any;
  let model: { findById: jest.Mock };
  let service: RestaurantsService;

  beforeEach(() => {
    restaurant = {
      _id: restaurantId,
      autoWithdrawal: { enabled: false },
      save: jest.fn().mockResolvedValue(undefined),
    };
    model = { findById: jest.fn().mockResolvedValue(restaurant) };
    service = new RestaurantsService(model as any, {} as any);
  });

  it('active le retrait avec un numéro Orange et le réseau correspondant', async () => {
    await service.updateAutoWithdrawal(actor, {
      enabled: true,
      phone: '691224472',
      accountBankCode: 'ORANGEMONEY',
    });

    expect(restaurant.autoWithdrawal).toEqual(
      expect.objectContaining({
        enabled: true,
        phone: '691224472',
        accountBankCode: 'ORANGEMONEY',
        updatedBy: new Types.ObjectId(String(managerId)),
      }),
    );
    expect(restaurant.save).toHaveBeenCalled();
  });

  it('refuse un numéro qui ne correspond pas au réseau', async () => {
    await expect(
      service.updateAutoWithdrawal(actor, {
        enabled: true,
        phone: '670123456',
        accountBankCode: 'ORANGEMONEY',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(restaurant.save).not.toHaveBeenCalled();
  });

  it('refuse l’activation sans numéro ou sans réseau', async () => {
    await expect(
      service.updateAutoWithdrawal(actor, { enabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('peut désactiver sans numéro', async () => {
    await service.updateAutoWithdrawal(actor, { enabled: false });

    expect(restaurant.autoWithdrawal.enabled).toBe(false);
    expect(restaurant.save).toHaveBeenCalled();
  });

  it('réserve la configuration au manager du restaurant', async () => {
    await expect(
      service.updateAutoWithdrawal(
        { ...actor, role: UserRole.ADMIN, restaurantId: undefined },
        { enabled: false },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});