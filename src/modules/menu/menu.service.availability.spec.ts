import { UserRole } from '../../common/enums/roles.enum';
import { MenuService } from './menu.service';

describe('MenuService — notifications de disponibilité', () => {
  const itemId = '6a022ebf8add1ba9a32a2579';

  let service: MenuService;
  let model: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let favorites: { notifyBackInStock: jest.Mock };

  const existingItem = (overrides: Record<string, any> = {}) => ({
    _id: itemId,
    name: 'Poulet pané',
    stock: 0,
    isAvailable: false,
    isActive: true,
    image: '',
    ...overrides,
  });

  beforeEach(() => {
    model = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    favorites = { notifyBackInStock: jest.fn() };

    const inventory = {
      normalizeAvailabilityForStock: (payload: any) =>
        payload.stock === undefined
          ? payload
          : { ...payload, isAvailable: payload.stock > 0 },
    };

    service = new MenuService(
      model as any,
      {} as any,
      {} as any,
      inventory as any,
      favorites as any,
    );
  });

  it('notifie quand le stock passe de 0 à un stock positif', async () => {
    model.findOne.mockResolvedValue(existingItem({ stock: 0, isAvailable: false }));
    model.findOneAndUpdate.mockResolvedValue(existingItem({ stock: 5, isAvailable: true }));

    await service.updateForActor({ role: UserRole.ADMIN }, itemId, { stock: 5 });

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: itemId },
      expect.objectContaining({ stock: 5, isAvailable: true }),
      { new: true },
    );
    expect(favorites.notifyBackInStock).toHaveBeenCalledWith(itemId);
  });

  it("ne notifie pas une simple augmentation de stock d'un produit déjà disponible", async () => {
    model.findOne.mockResolvedValue(existingItem({ stock: 5, isAvailable: true }));
    model.findOneAndUpdate.mockResolvedValue(existingItem({ stock: 10, isAvailable: true }));

    await service.updateForActor({ role: UserRole.ADMIN }, itemId, { stock: 10 });

    expect(favorites.notifyBackInStock).not.toHaveBeenCalled();
  });

  it('notifie à nouveau après une rupture puis un réapprovisionnement', async () => {
    model.findOne.mockResolvedValue(existingItem({ stock: 0, isAvailable: false }));
    model.findOneAndUpdate.mockResolvedValue(existingItem({ stock: 5, isAvailable: true }));

    // La consommation a ramené le stock à 0 : le produit est de nouveau
    // disponible, donc les favoris doivent être prévenus.
    await service.updateForActor({ role: UserRole.ADMIN }, itemId, { stock: 5 });

    expect(favorites.notifyBackInStock).toHaveBeenCalledTimes(1);
  });

  it("ne notifie pas quand le stock reste à 0 (produit toujours indisponible)", async () => {
    model.findOne.mockResolvedValue(existingItem({ stock: 5, isAvailable: true }));
    model.findOneAndUpdate.mockResolvedValue(existingItem({ stock: 0, isAvailable: false }));

    await service.updateForActor({ role: UserRole.ADMIN }, itemId, { stock: 0 });

    expect(favorites.notifyBackInStock).not.toHaveBeenCalled();
  });

  it("notifie quand un produit inactif avec du stock est activé", async () => {
    model.findOne.mockResolvedValue(
      existingItem({ stock: 5, isAvailable: true, isActive: false }),
    );
    model.findOneAndUpdate.mockResolvedValue(
      existingItem({ stock: 5, isAvailable: true, isActive: true }),
    );

    await service.activateForActor({ role: UserRole.ADMIN }, itemId);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: itemId },
      { isActive: true },
      { new: true },
    );
    expect(favorites.notifyBackInStock).toHaveBeenCalledWith(itemId);
  });
});