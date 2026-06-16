import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { UserRole } from '../../common/enums/roles.enum';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { DeliveryZone, DeliveryZoneDocument } from '../../database/schemas/delivery-zone.schema';
import { PromoCode, PromoCodeDocument } from '../../database/schemas/promo-code.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { Cart, CartDocument } from '../../database/schemas/cart.schema';
import { PreviewOrderDto } from './dto/preview-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CheckoutFromCartDto } from './dto/checkout-from-cart.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MenuInventoryService } from '../menu/menu-inventory.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';
import { buildTimeSeriesStats } from '../../common/stats/time-series-stats';
import {
  PromoCodeRedemption,
  PromoCodeRedemptionDocument,
} from '../../database/schemas/promo-code-redemption.schema';
import {
  allowedManualOrderStatuses,
  canManuallyTransitionOrderStatus,
} from '../../common/utils/order-status-transition.util';

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(DeliveryZone.name) private zoneModel: Model<DeliveryZoneDocument>,
    @InjectModel(PromoCode.name) private promoModel: Model<PromoCodeDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    @InjectModel(PromoCodeRedemption.name)
    private promoRedemptionModel: Model<PromoCodeRedemptionDocument>,
    private notifications: NotificationsService,
    private inventory: MenuInventoryService,
    private platformSettings: PlatformSettingsService,
  ) {}

  private async buildPreviewInputFromCart(userId: string, dto: CheckoutFromCartDto, session?: ClientSession): Promise<PreviewOrderDto> {
    const cart = await this.cartModel.findOne({ userId }).session(session || null);
    if (!cart || cart.items.length === 0) throw new BadRequestException('Cart is empty');
    if (!cart.restaurantId) throw new BadRequestException('Cart restaurant is not set');
    return {
      restaurantId: String(cart.restaurantId),
      items: cart.items.map((i) => ({
        menuItemId: String(i.menuItemId),
        quantity: i.quantity,
        accompanimentId: i.accompanimentId ? String(i.accompanimentId) : undefined,
        accompanimentName: i.accompanimentName || undefined,
      })),
      city: dto.city,
      district: dto.district,
      details: dto.details,
      promoCode: dto.promoCode,
      notes: dto.notes,
    };
  }

  private async placeOrderWithinSession(userId: string, dto: PreviewOrderDto, session: ClientSession) {
    const result = await this.calculate(dto, session, userId);

    // Réservation atomique du stock : on décrémente chaque item dans la même
    // transaction que la création de la commande. Si un item n'a plus assez de
    // stock (race avec une autre commande), on transforme l'exception brute en
    // erreur structurée INSUFFICIENT_STOCK pour que le frontend puisse réagir.
    for (const item of result.items) {
      try {
        await this.inventory.adjustStock(item.menuItemId, -item.quantity, session);
      } catch (error: any) {
        const isInsufficient = /Insufficient stock/i.test(String(error?.message || ''));
        if (isInsufficient) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_STOCK',
            message: `« ${item.name} » n'est plus disponible dans la quantité demandée.`,
            items: [{
              menuItemId: String(item.menuItemId),
              name: item.name,
              requested: item.quantity,
              available: 0,
              reason: 'insufficient',
            }],
          });
        }
        throw error;
      }
    }

    const [order] = await this.orderModel.create(
      [
        {
          orderNumber: `ORD-${Date.now()}-${randomUUID().slice(0, 5).toUpperCase()}`,
          userId,
          restaurantId: dto.restaurantId,
          items: result.items,
          deliveryAddress: { city: dto.city, district: dto.district, details: dto.details, mapLink: result.deliveryMapLink },
          pricingSnapshot: result.pricingSnapshot,
          deliveryEstimateMinutes: result.deliveryEstimateMinutes,
          promoCode: dto.promoCode?.toUpperCase(),
          paymentStatus: PaymentStatus.PENDING,
          orderStatus: OrderStatus.PENDING_PAYMENT,
          notes: dto.notes,
        },
      ],
      { session },
    );
    if (result.promo) {
      await this.consumePromoCode(result.promo, userId, order._id, session);
    }
    return order;
  }

  private async consumePromoCode(
    promo: PromoCodeDocument,
    userId: string,
    orderId: Types.ObjectId,
    session: ClientSession,
  ) {
    try {
      await this.promoRedemptionModel.create(
        [{
          promoCodeId: promo._id,
          userId: new Types.ObjectId(userId),
          orderId,
          code: promo.code,
        }],
        { session },
      );
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new BadRequestException('Vous avez déjà utilisé ce code promotionnel');
      }
      throw error;
    }

    const now = new Date();
    const usageFilter: any = {
      _id: promo._id,
      isActive: true,
      $and: [
        {
          $or: [
            { expirationDate: { $exists: false } },
            { expirationDate: null },
            { expirationDate: { $gte: now } },
          ],
        },
        {
          $or: [
            { usageLimit: { $exists: false } },
            { usageLimit: null },
            { $expr: { $lt: [{ $ifNull: ['$usedCount', 0] }, '$usageLimit'] } },
          ],
        },
      ],
    };
    const consumed = await this.promoModel.findOneAndUpdate(
      usageFilter,
      { $inc: { usedCount: 1 } },
      { new: true, session },
    );
    if (!consumed) {
      throw new BadRequestException('Ce code promotionnel a expiré ou sa limite d’utilisation est atteinte');
    }
  }

  private buildOrderListFilter(filters?: {
    q?: string;
    orderStatus?: OrderStatus;
    paymentStatus?: PaymentStatus;
    restaurantId?: string;
    userId?: string;
    from?: string;
    to?: string;
  }) {
    const filter: any = {};
    const qRegex = buildContainsRegex(filters?.q);
    if (qRegex) {
      filter.$or = [
        { orderNumber: qRegex },
        { promoCode: qRegex },
        { 'deliveryAddress.city': qRegex },
        { 'deliveryAddress.district': qRegex },
        { 'deliveryAddress.details': qRegex },
        { 'items.name': qRegex },
      ];
    }
    if (filters?.orderStatus) filter.orderStatus = filters.orderStatus;
    if (filters?.paymentStatus) filter.paymentStatus = filters.paymentStatus;
    if (filters?.restaurantId) filter.restaurantId = filters.restaurantId;
    if (filters?.userId) filter.userId = filters.userId;
    if (filters?.from || filters?.to) {
      filter.createdAt = {};
      if (filters.from) {
        const fromDate = new Date(filters.from);
        if (!Number.isNaN(fromDate.getTime())) filter.createdAt.$gte = fromDate;
      }
      if (filters.to) {
        const toDate = new Date(filters.to);
        if (!Number.isNaN(toDate.getTime())) filter.createdAt.$lte = toDate;
      }
      if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
    }
    return filter;
  }

  private populateOrderDetail(order: OrderDocument) {
    return order.populate([
      { path: 'restaurantId' },
      {
        path: 'userId',
        select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable',
      },
      {
        path: 'assignedDriverId',
        select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable',
      },
    ]);
  }

  private async calculate(dto: PreviewOrderDto, session?: ClientSession, userId?: string) {
    const restaurantId = String((dto.restaurantId as any)?._id ?? dto.restaurantId);
    const menuIds = dto.items.map((i) => new Types.ObjectId(i.menuItemId));
    const menuItems = await this.menuModel
      .find({ _id: { $in: menuIds }, restaurantId, isActive: true })
      .populate({ path: 'categoryId', select: 'name systemFeePerItem maxItemsPerOrder accompaniments' })
      .session(session || null);
    // Collecte tous les items manquants/désactivés/épuisés et lève une seule
    // erreur structurée `INSUFFICIENT_STOCK` pour permettre au frontend de
    // proposer des actions ciblées (réduire la quantité / retirer du panier).
    const stockIssues: Array<{
      menuItemId: string;
      name: string;
      requested: number;
      available: number;
      reason: 'unavailable' | 'insufficient';
    }> = [];

    for (const input of dto.items) {
      const menu = menuItems.find((m) => m._id.toString() === input.menuItemId);
      if (!menu) {
        stockIssues.push({
          menuItemId: input.menuItemId,
          name: 'Plat indisponible',
          requested: input.quantity,
          available: 0,
          reason: 'unavailable',
        });
        continue;
      }
      if (!menu.isAvailable || (menu.stock || 0) <= 0) {
        stockIssues.push({
          menuItemId: input.menuItemId,
          name: menu.name,
          requested: input.quantity,
          available: 0,
          reason: 'unavailable',
        });
        continue;
      }
      if (menu.stock < input.quantity) {
        stockIssues.push({
          menuItemId: input.menuItemId,
          name: menu.name,
          requested: input.quantity,
          available: menu.stock,
          reason: 'insufficient',
        });
      }
    }

    if (stockIssues.length > 0) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_STOCK',
        message: stockIssues.length === 1
          ? `« ${stockIssues[0].name} » n'est plus disponible dans la quantité demandée.`
          : `${stockIssues.length} articles de votre panier ne sont plus disponibles dans la quantité demandée.`,
        items: stockIssues,
      });
    }

    const zone = await this.zoneModel
      .findOne({ city: dto.city, district: dto.district, isActive: true })
      .session(session || null);
    if (!zone) throw new NotFoundException('Delivery zone not found');

    const items = dto.items.map((input) => {
      const menu = menuItems.find((m) => m._id.toString() === input.menuItemId);
      if (!menu) throw new BadRequestException('Invalid menu item');
      const category = menu.categoryId as any;
      const systemFeePerItem = Math.max(0, Math.floor(Number(category?.systemFeePerItem || 0)));

      // Snapshot de l'accompagnement choisi par le client. On valide qu'il
      // appartient bien aux availableAccompanimentIds du menu item, sinon on
      // l'ignore pour éviter qu'une commande forgée n'inclue un accompagnement
      // arbitraire dans son historique.
      let accompanimentId: any = null;
      let accompanimentName = '';
      if (input.accompanimentId) {
        const available = (menu.availableAccompanimentIds || []).map((id: any) => String(id));
        if (available.includes(String(input.accompanimentId))) {
          accompanimentId = input.accompanimentId;
          accompanimentName = String(input.accompanimentName || '');
          // Fallback: si pas de nom transmis, on tente d'aller le chercher
          // dans la catégorie embarquée.
          if (!accompanimentName && category?.accompaniments) {
            const sub = (category.accompaniments || []).find(
              (a: any) => String(a._id) === String(input.accompanimentId),
            );
            if (sub) accompanimentName = sub.name || '';
          }
        }
      }

      return {
        menuItemId: menu._id,
        categoryId: category?._id || null,
        name: menu.name,
        unitPrice: menu.price,
        packagingCost: menu.packagingCost || 0,
        systemFeePerItem,
        systemFeeTotal: systemFeePerItem * input.quantity,
        quantity: input.quantity,
        subtotal: menu.price * input.quantity,
        accompanimentId,
        accompanimentName,
      };
    });

    const categoryQuantities = new Map<string, { name: string; limit: number; quantity: number }>();
    dto.items.forEach((input) => {
      const menu = menuItems.find((candidate) => candidate._id.toString() === input.menuItemId);
      const category = menu?.categoryId as any;
      if (!category?._id) return;
      const categoryId = String(category._id);
      const current = categoryQuantities.get(categoryId) || {
        name: String(category.name || 'Cette catégorie'),
        limit: Math.max(0, Math.floor(Number(category.maxItemsPerOrder || 0))),
        quantity: 0,
      };
      current.quantity += input.quantity;
      categoryQuantities.set(categoryId, current);
    });
    for (const category of categoryQuantities.values()) {
      if (category.limit > 0 && category.quantity > category.limit) {
        throw new BadRequestException(
          `La catégorie "${category.name}" est limitée à ${category.limit} article(s) par commande`,
        );
      }
    }

    const itemsSubtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
    const packagingTotal = items.reduce((sum, i) => sum + i.packagingCost * i.quantity, 0);
    const categorySystemFeeTotal = items.reduce((sum, i) => sum + i.systemFeeTotal, 0);
    const deliveryFee = zone.deliveryFee;
    const deliveryEstimateMinutes = Number(zone.time || 0);
    const feeType = process.env.PLATFORM_FEE_TYPE || 'fixed'; // if fixed, PLATFORM_FEE_VALUE=value. if percentage, PLATFORM_FEE_VALUE=percentage
    const feeValue = Number(process.env.PLATFORM_FEE_VALUE || 0);
    const payableBeforePlatformFee = Number(itemsSubtotal + packagingTotal + deliveryFee);
    const platformFee = feeType === 'percentage' ? Math.ceil(payableBeforePlatformFee * feeValue / 100) : feeValue;

    let promoDiscount = 0;
    let promo: PromoCodeDocument | null = null;
    if (dto.promoCode) {
      promo = await this.promoModel
        .findOne({ code: dto.promoCode.toUpperCase(), isActive: true })
        .session(session || null);
      if (!promo) throw new BadRequestException('Promo code not found');
      if (promo.expirationDate && new Date(promo.expirationDate) < new Date()) throw new BadRequestException('Promo code expired');
      if (promo.usageLimit && promo.usedCount >= promo.usageLimit) throw new BadRequestException('Promo code limit reached');
      if (promo.minOrderAmount && itemsSubtotal < promo.minOrderAmount) throw new BadRequestException('Order below minimum promo amount');
      if (
        promo.applicableRestaurantIds?.length
        && !promo.applicableRestaurantIds.some((id) => String(id) === restaurantId)
      ) {
        throw new BadRequestException('Promo code not valid for this restaurant');
      }
      if (userId) {
        const alreadyUsed = await this.promoRedemptionModel
          .exists({ promoCodeId: promo._id, userId: new Types.ObjectId(userId) })
          .session(session || null);
        if (alreadyUsed) throw new BadRequestException('Vous avez déjà utilisé ce code promotionnel');
      }
      promoDiscount = Math.min(promo.amount, payableBeforePlatformFee);
    }
    const restaurantNetBeforeDelivery = itemsSubtotal + packagingTotal - promoDiscount;
    if (categorySystemFeeTotal > restaurantNetBeforeDelivery) {
      throw new BadRequestException(
        'Category system fees cannot exceed the items and packaging amount after discount',
      );
    }
    const paymentAmount = Math.max(0, payableBeforePlatformFee - promoDiscount);

    return {
      items,
      pricingSnapshot: {
        itemsSubtotal,
        packagingTotal,
        deliveryFee,
        platformFee,
        promoDiscount,
        paymentAmount,
        grandTotal: paymentAmount + platformFee,
        categorySystemFeeTotal,
        balanceDistributionVersion: 2,
      },
      deliveryEstimateMinutes,
      deliveryMapLink: zone.mapLink || '',
      promo,
    };
  }

  async preview(userId: string, dto: PreviewOrderDto) {
    return this.calculate(dto, undefined, userId);
  }

  async previewFromCart(userId: string, dto: CheckoutFromCartDto) {
    const previewInput = await this.buildPreviewInputFromCart(userId, dto);
    return this.calculate(previewInput, undefined, userId);
  }

  async create(userId: string, dto: PreviewOrderDto) {
    // Bloque la création hors fenêtre de service configurée
    // (PlatformSettings.ordering). Le contrôle frontend grise déjà l'UI mais
    // on revalide ici pour empêcher tout contournement par API directe.
    await this.platformSettings.assertOrderingOpen();

    const session = await this.orderModel.db.startSession();
    try {
      session.startTransaction();
      const order = await this.placeOrderWithinSession(userId, dto, session);
      await session.commitTransaction();
      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async createFromCart(userId: string, dto: CheckoutFromCartDto) {
    await this.platformSettings.assertOrderingOpen();

    const session = await this.orderModel.db.startSession();
    try {
      session.startTransaction();
      const previewInput = await this.buildPreviewInputFromCart(userId, dto, session);
      const order = await this.placeOrderWithinSession(userId, previewInput, session);
      await this.cartModel.findOneAndUpdate(
        { userId },
        { restaurantId: null, items: [] },
        { session },
      );
      await session.commitTransaction();
      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async myOrders(
    userId: string,
    page?: number,
    limit?: number,
    filters?: { q?: string; orderStatus?: OrderStatus; paymentStatus?: PaymentStatus; from?: string; to?: string },
  ) {
    const pagination = normalizePagination(page, limit);
    const filter = { userId, ...this.buildOrderListFilter(filters) };
    const [data, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .populate({
          path: 'userId',
          select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable',
        })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.orderModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async restaurantOrders(
    user: any,
    page?: number,
    limit?: number,
    filters?: {
      q?: string;
      orderStatus?: OrderStatus;
      paymentStatus?: PaymentStatus;
      restaurantId?: string;
      userId?: string;
      from?: string;
      to?: string;
    },
  ) {
    const pagination = normalizePagination(page, limit);
    let filter: any = this.buildOrderListFilter(filters);
    if ([UserRole.MANAGER, UserRole.EMPLOYEE].includes(user.role)) {
      filter = { ...filter, restaurantId: user.restaurantId };
    } else if (user.role === UserRole.DRIVER) {
      filter = { ...filter, assignedDriverId: user.sub };
    }

    const [data, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.orderModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  stats(user: any, period?: string, date?: string) {
    let filter: any = {};
    if ([UserRole.MANAGER, UserRole.EMPLOYEE].includes(user.role)) {
      filter.restaurantId = user.restaurantId;
    } else if (user.role === UserRole.DRIVER) {
      filter.assignedDriverId = user.sub;
    }
    return buildTimeSeriesStats(this.orderModel, period, date, filter);
  }

  async readyForDelivery(
    page?: number,
    limit?: number,
    filters?: {
      q?: string;
      status?: OrderStatus;
      restaurantId?: string;
      unassigned?: boolean;
      from?: string;
      to?: string;
    },
  ) {
    const processingStatuses: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.ASSIGNED,
      OrderStatus.OUT_FOR_DELIVERY,
    ];
    if (filters?.status && !processingStatuses.includes(filters.status)) {
      throw new BadRequestException(`status must be one of: ${processingStatuses.join(', ')}`);
    }

    const pagination = normalizePagination(page, limit);
    const orderStatusFilter = filters?.status
      ? filters.status
      : { $in: processingStatuses };
    const filter: any = {
      ...this.buildOrderListFilter({
        q: filters?.q,
        restaurantId: filters?.restaurantId,
        from: filters?.from,
        to: filters?.to,
      }),
      orderStatus: orderStatusFilter,
    };
    if (filters?.unassigned) {
      const existingOr = Array.isArray(filter.$or) ? filter.$or : null;
      if (existingOr) delete filter.$or;
      filter.$and = [
        ...(Array.isArray(filter.$and) ? filter.$and : []),
        ...(existingOr ? [{ $or: existingOr }] : []),
        {
          $or: [
        { assignedDriverId: null },
        { assignedDriverId: { $exists: false } },
          ],
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .populate({ path: 'restaurantId' })
        .populate({ path: 'userId', select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable' })
        .populate({ path: 'assignedDriverId', select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable' })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.orderModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async findOneForActor(id: string, actor: any) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');

    if (actor.role === UserRole.ADMIN) return this.populateOrderDetail(order);
    if (actor.role === UserRole.CLIENT && String(order.userId) === actor.sub) return this.populateOrderDetail(order);
    if ([UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role) && String(order.restaurantId) === String(actor.restaurantId)) {
      return this.populateOrderDetail(order);
    }
    if (actor.role === UserRole.DRIVER && String(order.assignedDriverId) === actor.sub) {
      return this.populateOrderDetail(order);
    }

    throw new ForbiddenException('You are not allowed to access this order');
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto, actor: any) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');

    if ([UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role) && String(order.restaurantId) !== String(actor.restaurantId)) {
      throw new ForbiddenException('You can only update orders from your restaurant');
    }
    if (![UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role)) {
      throw new ForbiddenException('Les statuts de livraison doivent être modifiés depuis la livraison assignée');
    }

    const currentStatus = order.orderStatus as OrderStatus;
    if (!canManuallyTransitionOrderStatus(currentStatus, dto.orderStatus)) {
      const allowed = allowedManualOrderStatuses(currentStatus);
      throw new BadRequestException(
        allowed.length
          ? `Transition de commande invalide. Statut autorisé: ${allowed.join(', ')}`
          : `Aucune transition manuelle n’est autorisée depuis le statut ${currentStatus}`,
      );
    }
    if (order.paymentStatus !== PaymentStatus.PAID) {
      throw new BadRequestException('La commande doit être payée avant de poursuivre sa préparation');
    }
    order.orderStatus = dto.orderStatus;
    await order.save();

    const user = await this.userModel.findById(order.userId);
    if (user) await this.notifications.sendStatusChanged(user.email, user.phone, order.orderNumber, order.orderStatus);
    return order;
  }
}
