import * as mongoose from 'mongoose';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { MenuService } from './menu.service';
import { MenuItem, MenuItemSchema } from '../../database/schemas/menu-item.schema';

const RESTAURANT_ID = new Types.ObjectId();

describe('MenuItem — canaux onSite/onDelivery', () => {
  it('defaults du schema : onSite et onDelivery valent true pour un item sans le champ', () => {
    const MenuItemModel = mongoose.model('MenuItemDefaultsSpec', MenuItemSchema);
    const doc = new MenuItemModel({
      name: 'Poulet DG',
      price: 3500,
      restaurantId: RESTAURANT_ID,
    });
    expect(doc.onSite).toBe(true);
    expect(doc.onDelivery).toBe(true);
  });

  it('schema : onSite/onDelivery explicites sont respectés', () => {
    const MenuItemModel = mongoose.model('MenuItemDefaultsSpec', MenuItemSchema);
    const doc = new MenuItemModel({
      name: 'Poulet DG',
      price: 3500,
      restaurantId: RESTAURANT_ID,
      onSite: false,
      onDelivery: true,
    });
    expect(doc.onSite).toBe(false);
    expect(doc.onDelivery).toBe(true);
  });
});

describe('MenuService — propagation DTO et filtre canal', () => {
  let service: MenuService;
  let model: { create: jest.Mock; find: jest.Mock; countDocuments: jest.Mock };
  let restaurantModel: { exists: jest.Mock };
  let inventory: { normalizeAvailabilityForStock: (payload: any) => any };

  beforeEach(() => {
    inventory = { normalizeAvailabilityForStock: (payload: any) => payload };
    restaurantModel = { exists: jest.fn().mockResolvedValue({ _id: 'r1' }) };
    model = {
      create: jest.fn().mockImplementation(async (payload: any) => ({ _id: new Types.ObjectId(), ...payload })),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    service = new MenuService(
      model as any,
      restaurantModel as any,
      {} as any,
      inventory as any,
      {} as any,
    );
  });

  describe('createForActor — propagation des champs onSite/onDelivery', () => {
    it('crée avec onSite: false et onDelivery: true persistés', async () => {
      await service.createForActor(
        { role: UserRole.ADMIN },
        { restaurantId: String(RESTAURANT_ID), name: 'Poulet DG', price: 3500, onSite: false, onDelivery: true },
      );

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ onSite: false, onDelivery: true }),
      );
    });

    it('sans le champ : le payload ne contient pas onSite/onDelivery (le default schema true s\'applique)', async () => {
      await service.createForActor(
        { role: UserRole.ADMIN },
        { restaurantId: String(RESTAURANT_ID), name: 'Poulet DG', price: 3500 },
      );

      const payload = model.create.mock.calls[0][0];
      expect(payload.onSite).toBeUndefined();
      expect(payload.onDelivery).toBeUndefined();
    });
  });

  describe('findPublicByRestaurant — filtre canal onSite', () => {
    const items = [
      { _id: 'a', name: 'Sur place', onSite: true },
      { _id: 'b', name: 'Livraison uniquement', onSite: false },
      { _id: 'c', name: 'Ancien item (champ absent)' },
    ];

    /** Applique la sémantique Mongo `$ne: false` : les champs absents ne sont PAS exclus. */
    function applyOnSiteFilter(filter: any, list: typeof items) {
      const cond = filter.onSite;
      if (cond === undefined) return list;
      if (cond && typeof cond === 'object' && '$ne' in cond) {
        return list.filter((item) => item.onSite !== cond.$ne);
      }
      return list.filter((item) => item.onSite === cond);
    }

    function stubFind(list: typeof items) {
      return jest.fn().mockImplementation((filter: any) => {
        const data = applyOnSiteFilter(filter, list);
        return {
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue(data),
        };
      });
    }

    it('onSite=true : filtre défensif { $ne: false } — item false exclu, champ absent inclus', async () => {
      model.find = stubFind(items);
      model.countDocuments = jest.fn().mockResolvedValue(2);

      const result = await service.findPublicByRestaurant(String(RESTAURANT_ID), 1, 10, { onSite: 'true' });

      expect(model.find).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: expect.anything(),
          isActive: true,
          isAvailable: true,
          onSite: { $ne: false },
        }),
      );
      expect(result.data.map((item: any) => item._id)).toEqual(['a', 'c']);
      expect(result.meta.total).toBe(2);
    });

    it('sans le paramètre : aucun filtre de canal (comportement inchangé)', async () => {
      model.find = stubFind(items);
      model.countDocuments = jest.fn().mockResolvedValue(3);

      const result = await service.findPublicByRestaurant(String(RESTAURANT_ID), 1, 10, {});

      const filter = model.find.mock.calls[0][0];
      expect(filter.onSite).toBeUndefined();
      expect(result.data).toHaveLength(3);
    });

    it('onSite=false : filtre défensif $ne: true — item true exclu, champ absent inclus (m7)', async () => {
      model.find = stubFind(items);
      model.countDocuments = jest.fn().mockResolvedValue(2);

      const result = await service.findPublicByRestaurant(String(RESTAURANT_ID), 1, 10, { onSite: 'false' });

      const filter = model.find.mock.calls[0][0];
      expect(filter.onSite).toEqual({ $ne: true });
      // Symétrique de la branche true : item onSite=true exclu, champ absent inclus.
      expect(result.data.map((item: any) => item._id)).toEqual(['b', 'c']);
      expect(result.meta.total).toBe(2);
    });
  });
});
