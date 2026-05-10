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
import { OrderStatus } from '../../common/enums/order-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(DeliveryZone.name) private zoneModel: Model<DeliveryZoneDocument>,
    @InjectModel(PromoCode.name) private promoModel: Model<PromoCodeDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    private notifications: NotificationsService,
  ) {}

  private async buildPreviewInputFromCart(userId: string, dto: CheckoutFromCartDto, session?: ClientSession): Promise<PreviewOrderDto> {
    const cart = await this.cartModel.findOne({ userId }).session(session || null);
    if (!cart || cart.items.length === 0) throw new BadRequestException('Cart is empty');
    if (!cart.restaurantId) throw new BadRequestException('Cart restaurant is not set');
    return {
      restaurantId: String(cart.restaurantId),
      items: cart.items.map((i) => ({ menuItemId: String(i.menuItemId), quantity: i.quantity })),
      city: dto.city,
      district: dto.district,
      details: dto.details,
      promoCode: dto.promoCode,
      notes: dto.notes,
    };
  }

  private async placeOrderWithinSession(userId: string, dto: PreviewOrderDto, session: ClientSession) {
    const result = await this.calculate(dto, session);

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
    return order;
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
        select: 'firstName lastName email phone profileImage role restaurantId isActive',
      },
      {
        path: 'assignedDriverId',
        select: 'firstName lastName email phone profileImage role restaurantId isActive',
      },
    ]);
  }

  private async calculate(dto: PreviewOrderDto, session?: ClientSession) {
    const restaurantId = String((dto.restaurantId as any)?._id ?? dto.restaurantId);
    const menuIds = dto.items.map((i) => new Types.ObjectId(i.menuItemId));
    const menuItems = await this.menuModel
      .find({ _id: { $in: menuIds }, restaurantId, isActive: true })
      .session(session || null);
    if (menuItems.length !== dto.items.length) throw new BadRequestException('Some menu items are invalid');
    const zone = await this.zoneModel
      .findOne({ city: dto.city, district: dto.district, isActive: true })
      .session(session || null);
    if (!zone) throw new NotFoundException('Delivery zone not found');

    const items = dto.items.map((input) => {
      const menu = menuItems.find((m) => m._id.toString() === input.menuItemId);
      if (!menu) throw new BadRequestException('Invalid menu item');
      if (menu.stock < input.quantity) throw new BadRequestException(`Insufficient stock for ${menu.name}`);
      return {
        menuItemId: menu._id,
        name: menu.name,
        unitPrice: menu.price,
        packagingCost: menu.packagingCost || 0,
        quantity: input.quantity,
        subtotal: menu.price * input.quantity,
      };
    });

    const itemsSubtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
    const packagingTotal = items.reduce((sum, i) => sum + i.packagingCost * i.quantity, 0);
    const deliveryFee = zone.deliveryFee;
    const deliveryEstimateMinutes = Number(zone.time || 0);
    const feeType = process.env.PLATFORM_FEE_TYPE || 'fixed'; // if fixed, PLATFORM_FEE_VALUE=value. if percentage, PLATFORM_FEE_VALUE=percentage
    const feeValue = Number(process.env.PLATFORM_FEE_VALUE || 0);
    const val = Number(itemsSubtotal + packagingTotal + deliveryFee)
    const platformFee = feeType === 'percentage' ? Math.round(val * feeValue / 100) : feeValue;

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
      promoDiscount = Math.min(promo.amount, itemsSubtotal + packagingTotal + deliveryFee + platformFee);
    }

    return {
      items,
      pricingSnapshot: {
        itemsSubtotal,
        packagingTotal,
        deliveryFee,
        platformFee,
        promoDiscount,
        grandTotal: itemsSubtotal + packagingTotal + deliveryFee + platformFee - promoDiscount,
      },
      deliveryEstimateMinutes,
      deliveryMapLink: zone.mapLink || '',
      promo,
    };
  }

  async preview(dto: PreviewOrderDto) {
    return this.calculate(dto);
  }

  async previewFromCart(userId: string, dto: CheckoutFromCartDto) {
    const previewInput = await this.buildPreviewInputFromCart(userId, dto);
    return this.calculate(previewInput);
  }

  async create(userId: string, dto: PreviewOrderDto) {
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
          select: 'firstName lastName email phone profileImage role restaurantId isActive',
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

  async readyForDelivery(
    page?: number,
    limit?: number,
    filters?: {
      q?: string;
      status?: OrderStatus;
      restaurantId?: string;
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
    if (actor.role === UserRole.DRIVER && String(order.assignedDriverId) !== actor.sub) {
      throw new ForbiddenException('You can only update your assigned orders');
    }
    if (dto.assignedDriverId && ![UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role)) {
      throw new ForbiddenException('Only admin, manager or employee can assign a driver');
    }

    order.orderStatus = dto.orderStatus;
    if (dto.orderStatus === OrderStatus.OUT_FOR_DELIVERY && !order.outForDeliveryAt) order.outForDeliveryAt = new Date();
    if (dto.assignedDriverId) order.assignedDriverId = new Types.ObjectId(dto.assignedDriverId);
    await order.save();

    const user = await this.userModel.findById(order.userId);
    if (user) await this.notifications.sendStatusChanged(user.email, user.phone, order.orderNumber, order.orderStatus);
    return order;
  }
}
