import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { OrdersService } from './orders.service';
import { orderBalanceDistribution } from '../payments/utils/order-balance-distribution.util';

const RESTAURANT_ID = new Types.ObjectId();
const OTHER_RESTAURANT_ID = new Types.ObjectId();
const ITEM_A = new Types.ObjectId();
const ITEM_B = new Types.ObjectId();

const managerActor = {
  sub: new Types.ObjectId().toString(),
  email: 'manager@resto.cm',
  role: UserRole.MANAGER,
  restaurantId: String(RESTAURANT_ID),
};
const adminActor = {
  sub: new Types.ObjectId().toString(),
  email: 'admin@eat.cm',
  role: UserRole.ADMIN,
};

function menuDoc(overrides: Record<string, any> = {}) {
  return {
    _id: ITEM_A,
    name: 'Poulet DG',
    price: 1000,
    packagingCost: 100,
    stock: 10,
    isAvailable: true,
    isActive: true,
    onSite: true,
    categoryId: null,
    availableAccompanimentIds: [],
    ...overrides,
  };
}

function makeDto(overrides: Record<string, any> = {}) {
  return {
    restaurantId: String(RESTAURANT_ID),
    items: [
      { menuItemId: String(ITEM_A), quantity: 2 },
      { menuItemId: String(ITEM_B), quantity: 1 },
    ],
    tableLabel: 'Table 3',
    ...overrides,
  };
}

describe('OrdersService — commandes on-site', () => {
  let service: OrdersService;
  let menuModel: any;
  let orderModel: any;
  let zoneModel: any;
  let promoModel: any;
  let userModel: any;
  let cartModel: any;
  let promoRedemptionModel: any;
  let deliveryModel: any;
  let notifications: any;
  let inventory: any;
  let platformSettings: any;
  let payments: any;
  let auditLogs: any;
  let session: any;

  function menuFindChain(docs: any[]) {
    return {
      populate: jest.fn().mockReturnThis(),
      session: jest.fn().mockResolvedValue(docs),
    };
  }

  beforeEach(() => {
    menuModel = { find: jest.fn() };
    orderModel = {
      db: { startSession: jest.fn() },
      create: jest.fn(),
    };
    zoneModel = { findOne: jest.fn() };
    promoModel = { findOne: jest.fn() };
    userModel = {};
    cartModel = {};
    promoRedemptionModel = { create: jest.fn(), exists: jest.fn() };
    deliveryModel = { findOne: jest.fn() };
    notifications = {};
    inventory = { adjustStock: jest.fn().mockResolvedValue({}) };
    platformSettings = { assertOrderingOpen: jest.fn().mockResolvedValue(undefined) };
    payments = {};
    auditLogs = { record: jest.fn() };

    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    orderModel.db.startSession.mockResolvedValue(session);

    // La création renvoie un document enrichi (_id) pour vérifier la répartition.
    orderModel.create.mockImplementation(async (docs: any[]) =>
      docs.map((d) => ({ _id: new Types.ObjectId(), orderNumber: 'ORD-TEST-1', ...d })),
    );

    service = new OrdersService(
      menuModel,
      orderModel,
      zoneModel,
      promoModel,
      userModel,
      cartModel,
      promoRedemptionModel,
      deliveryModel,
      notifications,
      inventory,
      platformSettings,
      payments,
      auditLogs,
    );
  });

  describe('createOnSite — succès', () => {
    beforeEach(() => {
      menuModel.find.mockReturnValue(menuFindChain([
        menuDoc({ _id: ITEM_A, price: 1000 }),
        menuDoc({ _id: ITEM_B, price: 500, packagingCost: 0 }),
      ]));
    });

    it('manager : snapshot pricing = Σ prix×qty, frais tous à 0, orderType on_site, userId = staff', async () => {
      const order = await service.createOnSite(managerActor, makeDto());

      expect(order.orderType).toBe('on_site');
      expect(String(order.userId)).toBe(managerActor.sub);
      expect(String(order.restaurantId)).toBe(String(RESTAURANT_ID));
      expect(order.deliveryAddress).toBeUndefined();
      expect(order.tableLabel).toBe('Table 3');
      expect(order.pricingSnapshot).toEqual({
        itemsSubtotal: 2500,
        packagingTotal: 0,
        deliveryFee: 0,
        platformFee: 0,
        promoDiscount: 0,
        paymentAmount: 2500,
        grandTotal: 2500,
        categorySystemFeeTotal: 0,
        balanceDistributionVersion: 3,
      });
      expect(order.items).toHaveLength(2);
      expect(order.items[0].subtotal).toBe(2000);
    });

    it('répartition v3 : 100 % au restaurant (systemAmount=0, driverAmount=0)', async () => {
      const order = await service.createOnSite(managerActor, makeDto());

      const dist = orderBalanceDistribution(order);
      expect(dist.restaurantAmount).toBe(2500);
      expect(dist.systemAmount).toBe(0);
      expect(dist.driverAmount).toBe(0);
    });

    it('stock décrémenté atomiquement dans la transaction', async () => {
      await service.createOnSite(managerActor, makeDto());

      expect(inventory.adjustStock.mock.calls).toEqual([
        [ITEM_A, -2, session],
        [ITEM_B, -1, session],
      ]);
      expect(session.commitTransaction).toHaveBeenCalledTimes(1);
      expect(session.endSession).toHaveBeenCalledTimes(1);
    });

    it('assertOrderingOpen appliqué aux commandes on-site', async () => {
      await service.createOnSite(managerActor, makeDto());

      expect(platformSettings.assertOrderingOpen).toHaveBeenCalledTimes(1);
    });

    it('audit journalisé en order.create_on_site', async () => {
      const order = await service.createOnSite(managerActor, makeDto());

      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'order.create_on_site',
          actorId: managerActor.sub,
          actorRole: UserRole.MANAGER,
          resourceId: String(order._id),
        }),
      );
    });

    it('admin : restaurantId du DTO accepté', async () => {
      const order = await service.createOnSite(adminActor, makeDto());

      expect(String(order.restaurantId)).toBe(String(RESTAURANT_ID));
    });

    it('manager : restaurantId du DTO forcé à son propre restaurant', async () => {
      await service.createOnSite(managerActor, { ...makeDto(), restaurantId: managerActor.restaurantId });

      expect(String(orderModel.create.mock.calls[0][0][0].restaurantId)).toBe(String(RESTAURANT_ID));
    });
  });

  describe('createOnSite — refus', () => {
    it('item non-onSite (onSite: false) → INSUFFICIENT_STOCK structuré (unavailable), aucun stock décrémenté', async () => {
      // Le filtre canal exclut l'item non-onSite : seul ITEM_B (onSite par défaut) est renvoyé.
      menuModel.find.mockReturnValue(menuFindChain([
        menuDoc({ _id: ITEM_B, price: 500, packagingCost: 0 }),
      ]));

      const error = await service.createOnSite(managerActor, makeDto()).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          code: 'INSUFFICIENT_STOCK',
          items: [
            expect.objectContaining({ menuItemId: String(ITEM_A), reason: 'unavailable' }),
          ],
        }),
      );
      // Le filtre canal est bien envoyé à Mongo ($ne: false, défensif).
      expect(menuModel.find.mock.calls[0][0]).toEqual(
        expect.objectContaining({ onSite: { $ne: false } }),
      );
      expect(inventory.adjustStock).not.toHaveBeenCalled();
      expect(orderModel.create).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    });

    it('stock insuffisant → INSUFFICIENT_STOCK structuré avec quantité disponible', async () => {
      menuModel.find.mockReturnValue(menuFindChain([
        menuDoc({ _id: ITEM_A, stock: 1 }),
        menuDoc({ _id: ITEM_B, price: 500, packagingCost: 0 }),
      ]));

      const error = await service.createOnSite(managerActor, makeDto()).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          code: 'INSUFFICIENT_STOCK',
          items: [
            expect.objectContaining({
              menuItemId: String(ITEM_A),
              requested: 2,
              available: 1,
              reason: 'insufficient',
            }),
          ],
        }),
      );
      expect(inventory.adjustStock).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    });

    it('manager cross-restaurant → 403, aucune transaction ni requête menu', async () => {
      await expect(
        service.createOnSite(managerActor, { ...makeDto(), restaurantId: String(OTHER_RESTAURANT_ID) }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(orderModel.db.startSession).not.toHaveBeenCalled();
      expect(menuModel.find).not.toHaveBeenCalled();
      expect(inventory.adjustStock).not.toHaveBeenCalled();
    });

    it('sans items → 400, transaction annulée', async () => {
      await expect(service.createOnSite(managerActor, { ...makeDto(), items: [] })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(orderModel.create).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    });

    it('rôle CLIENT → 403 (défense en profondeur, seul le personnel crée au comptoir)', async () => {
      await expect(
        service.createOnSite({ sub: 'client-1', role: UserRole.CLIENT }, makeDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(orderModel.db.startSession).not.toHaveBeenCalled();
    });
  });

  describe('T4 — garde adresse obligatoire pour les commandes delivery', () => {
    it('commande delivery sans adresse → 400 « Adresse de livraison requise »', async () => {
      const error = await service
        .create('client-1', {
          restaurantId: String(RESTAURANT_ID),
          items: [{ menuItemId: String(ITEM_A), quantity: 1 }],
        } as any)
        .catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Adresse de livraison requise');
      expect(menuModel.find).not.toHaveBeenCalled();
      expect(zoneModel.findOne).not.toHaveBeenCalled();
      expect(inventory.adjustStock).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalledTimes(1);
      expect(session.endSession).toHaveBeenCalledTimes(1);
    });
  });
});
