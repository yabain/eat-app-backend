import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Balance, BalanceDocument } from '../../database/schemas/balance.schema';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { UserRole } from '../../common/enums/roles.enum';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>,
    @InjectModel(Balance.name) private balanceModel: Model<BalanceDocument>,
  ) {}

  private readonly dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  private readonly monthLabels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

  private normalizePeriod(period = 'week'): 'week' | 'month' | '12m' {
    return period === 'month' || period === '12m' ? period : 'week';
  }

  private periodStart(period = 'week'): Date {
    const normalized = this.normalizePeriod(period);
    const now = new Date();
    if (normalized === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
    if (normalized === '12m') return new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const start = new Date(now);
    const day = start.getDay() || 7;
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - day + 1);
    return start;
  }

  private groupFormat(period = 'week'): string {
    return this.normalizePeriod(period) === '12m' ? '%Y-%m' : '%Y-%m-%d';
  }

  private buildEmptySeries(period = 'week', start: Date) {
    const normalized = this.normalizePeriod(period);
    const now = new Date();
    const points: { key: string; label: string; orders: number; paidOrders: number; revenue: number }[] = [];
    const pad = (value: number) => String(value).padStart(2, '0');

    if (normalized === '12m') {
      for (let i = 0; i < 12; i++) {
        const date = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
        points.push({ key, label: `${this.monthLabels[date.getMonth()]} ${date.getFullYear()}`, orders: 0, paidOrders: 0, revenue: 0 });
      }
      return points;
    }

    const endDay = normalized === 'week' ? 6 : now.getDate() - 1;
    for (let i = 0; i <= endDay; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      points.push({ key, label: `${this.dayLabels[date.getDay()]} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`, orders: 0, paidOrders: 0, revenue: 0 });
    }
    return points;
  }

  private hydrateSeries(period: string, start: Date, series: any[]) {
    const points = this.buildEmptySeries(period, start);
    const byKey = new Map(series.map((item) => [item._id, item]));
    return points.map((point) => {
      const item = byKey.get(point.key) as any;
      return {
        label: point.label,
        orders: item?.orders || 0,
        paidOrders: item?.paidOrders || 0,
        revenue: item?.revenue || 0,
      };
    });
  }

  private restaurantIdFilter(restaurantId: string) {
    const values: any[] = [restaurantId];
    if (Types.ObjectId.isValid(restaurantId)) values.push(new Types.ObjectId(restaurantId));
    return { restaurantId: { $in: values } };
  }

  private restaurantFilter(actor: any, restaurantId?: string) {
    if (actor.role === UserRole.ADMIN) return restaurantId ? this.restaurantIdFilter(restaurantId) : {};
    if ([UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role)) {
      if (!actor.restaurantId) throw new ForbiddenException('Restaurant context is required');
      return this.restaurantIdFilter(String(actor.restaurantId));
    }
    throw new ForbiddenException('You are not allowed to access dashboard stats');
  }

  async overview(actor: any, period = 'week', restaurantId?: string) {
    const normalizedPeriod = this.normalizePeriod(period);
    const start = this.periodStart(normalizedPeriod);
    const restaurantFilter = this.restaurantFilter(actor, restaurantId);
    const dateFilter = { createdAt: { $gte: start } };
    const orderFilter = { ...restaurantFilter, ...dateFilter };
    const paidOrderFilter = { ...orderFilter, paymentStatus: PaymentStatus.PAID };
    const scopedRestaurantId = restaurantId || (actor.role !== UserRole.ADMIN ? String(actor.restaurantId || '') : '');
    const isRestaurantScope = Boolean(scopedRestaurantId);
    const balanceFilter = isRestaurantScope
      ? { accountType: 'restaurant', ownerId: scopedRestaurantId }
      : { accountType: 'system', ownerId: '0000000' };

    const [ordersTotal, paidOrders, menuItemsTotal, balanceAgg, revenueAgg, series, topItems, restaurantBalances] = await Promise.all([
      this.orderModel.countDocuments(orderFilter),
      this.orderModel.countDocuments(paidOrderFilter),
      this.menuModel.countDocuments(restaurantFilter),
      this.balanceModel.findOne(balanceFilter),
      this.orderModel.aggregate([
        { $match: paidOrderFilter },
        { $group: {
          _id: null,
          grossRevenue: { $sum: '$pricingSnapshot.grandTotal' },
          platformFees: { $sum: '$pricingSnapshot.platformFee' },
          deliveryFees: { $sum: '$pricingSnapshot.deliveryFee' },
          promoDiscounts: { $sum: '$pricingSnapshot.promoDiscount' },
        } },
      ]),
      this.orderModel.aggregate([
        { $match: orderFilter },
        { $group: {
          _id: { $dateToString: { format: this.groupFormat(normalizedPeriod), date: '$createdAt', timezone: 'Africa/Douala' } },
          orders: { $sum: 1 },
          paidOrders: { $sum: { $cond: [{ $eq: ['$paymentStatus', PaymentStatus.PAID] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $eq: ['$paymentStatus', PaymentStatus.PAID] }, '$pricingSnapshot.grandTotal', 0] } },
        } },
        { $sort: { _id: 1 } },
      ]),
      this.orderModel.aggregate([
        { $match: paidOrderFilter },
        { $unwind: '$items' },
        { $group: {
          _id: '$items.menuItemId',
          name: { $first: '$items.name' },
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.subtotal' },
        } },
        { $sort: { quantity: -1 } },
        { $limit: 8 },
      ]),
      actor.role === UserRole.ADMIN && !restaurantId
        ? this.balanceModel.aggregate([
            { $match: { accountType: 'restaurant' } },
            { $addFields: { ownerObjectId: { $toObjectId: '$ownerId' } } },
            { $lookup: { from: 'restaurants', localField: 'ownerObjectId', foreignField: '_id', as: 'restaurant' } },
            { $unwind: { path: '$restaurant', preserveNullAndEmptyArrays: true } },
            { $sort: { balance: -1 } },
            { $limit: 20 },
          ])
        : Promise.resolve([]),
    ]);

    const revenue = revenueAgg[0] || {};
    const isAdmin = actor.role === UserRole.ADMIN;
    const metrics: any = {
      ordersTotal,
      paidOrders,
      menuItemsTotal,
      grossRevenue: Number(revenue.grossRevenue || 0),
      promoDiscounts: Number(revenue.promoDiscounts || 0),
    };

    if (isAdmin) {
      metrics.platformFees = Number(revenue.platformFees || 0);
      metrics.deliveryFees = Number(revenue.deliveryFees || 0);
    }

    return {
      period: normalizedPeriod,
      scope: isRestaurantScope ? 'restaurant' : 'system',
      balance: Number((balanceAgg as any)?.balance || 0),
      metrics,
      series: this.hydrateSeries(normalizedPeriod, start, series),
      topItems: topItems.map((item) => ({ menuItemId: item._id, name: item.name, quantity: item.quantity, revenue: item.revenue })),
      restaurantBalances: restaurantBalances.map((item: any) => ({
        restaurantId: item.ownerId,
        restaurantName: item.restaurant?.name || String(item.ownerId),
        logo: item.restaurant?.logo,
        balance: item.balance,
      })),
    };
  }
}
