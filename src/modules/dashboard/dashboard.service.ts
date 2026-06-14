import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Balance, BalanceDocument } from '../../database/schemas/balance.schema';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { UserRole } from '../../common/enums/roles.enum';

type DashboardPeriod = 'day' | 'month' | 'year';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>,
    @InjectModel(Balance.name) private balanceModel: Model<BalanceDocument>,
  ) {}

  private readonly timezone = 'Africa/Douala';
  private readonly monthLabels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

  private normalizePeriod(period?: string): DashboardPeriod {
    return period === 'month' || period === 'year' ? period : 'day';
  }

  private rangeFor(period: DashboardPeriod, dateValue?: string) {
    const now = new Date();
    const input = String(dateValue || '').trim();
    const base = input ? new Date(input) : now;
    const valid = Number.isNaN(base.getTime()) ? now : base;

    if (period === 'year') {
      const year = input && /^\d{4}$/.test(input) ? Number(input) : this.parts(valid).year;
      return {
        selectedDate: String(year),
        start: this.doualaLocalDateToUtc(year, 1, 1),
        end: this.doualaLocalDateToUtc(year + 1, 1, 1),
      };
    }

    if (period === 'month') {
      const match = input.match(/^(\d{4})-(\d{2})$/);
      const parts = this.parts(valid);
      const year = match ? Number(match[1]) : parts.year;
      const month = match ? Number(match[2]) : parts.month;
      return {
        selectedDate: `${year}-${String(month).padStart(2, '0')}`,
        start: this.doualaLocalDateToUtc(year, month, 1),
        end: this.doualaLocalDateToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1),
      };
    }

    const parts = this.parts(valid);
    const selectedDate = input && /^\d{4}-\d{2}-\d{2}$/.test(input)
      ? input
      : `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    const [year, month, day] = selectedDate.split('-').map(Number);
    return {
      selectedDate,
      start: this.doualaLocalDateToUtc(year, month, day),
      end: this.doualaLocalDateToUtc(year, month, day + 1),
    };
  }

  private parts(date: Date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    return {
      year: Number(parts.find((part) => part.type === 'year')?.value),
      month: Number(parts.find((part) => part.type === 'month')?.value),
      day: Number(parts.find((part) => part.type === 'day')?.value),
    };
  }

  private daysInSelectedMonth(selectedDate: string) {
    const [year, month] = selectedDate.split('-').map(Number);
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  private doualaLocalDateToUtc(year: number, month: number, day: number) {
    return new Date(Date.UTC(year, month - 1, day, -1, 0, 0, 0));
  }

  private labelFor(period: DashboardPeriod, bucket: number) {
    if (period === 'day') return `${String(bucket).padStart(2, '0')}h`;
    if (period === 'month') return String(bucket);
    return this.monthLabels[bucket - 1] || String(bucket);
  }

  private aggregateSeries(period: DashboardPeriod, filter: FilterQuery<OrderDocument>) {
    const operator = period === 'day' ? '$hour' : period === 'month' ? '$dayOfMonth' : '$month';
    return this.orderModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { [operator]: { date: '$createdAt', timezone: this.timezone } },
          orders: { $sum: 1 },
          paidOrders: { $sum: { $cond: [{ $eq: ['$paymentStatus', PaymentStatus.PAID] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $eq: ['$paymentStatus', PaymentStatus.PAID] }, '$pricingSnapshot.grandTotal', 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          bucket: '$_id',
          orders: 1,
          paidOrders: 1,
          revenue: 1,
        },
      },
      { $sort: { bucket: 1 } },
    ]);
  }

  private fillSeries(
    period: DashboardPeriod,
    range: { selectedDate: string },
    rows: Array<{ bucket: number; orders: number; paidOrders: number; revenue: number }>,
  ) {
    const byBucket = new Map(rows.map((row) => [
      Number(row.bucket),
      {
        orders: Number(row.orders || 0),
        paidOrders: Number(row.paidOrders || 0),
        revenue: Number(row.revenue || 0),
      },
    ]));
    const length = period === 'day' ? 24 : period === 'month' ? this.daysInSelectedMonth(range.selectedDate) : 12;
    const startIndex = period === 'day' ? 0 : 1;

    return Array.from({ length }, (_, index) => {
      const bucket = index + startIndex;
      const data = byBucket.get(bucket) || { orders: 0, paidOrders: 0, revenue: 0 };
      return {
        bucket,
        label: this.labelFor(period, bucket),
        orders: data.orders,
        paidOrders: data.paidOrders,
        revenue: data.revenue,
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

  async overview(actor: any, period?: string, restaurantId?: string, date?: string) {
    const normalizedPeriod = this.normalizePeriod(period);
    const range = this.rangeFor(normalizedPeriod, date);
    const restaurantFilter = this.restaurantFilter(actor, restaurantId);
    const dateFilter = { createdAt: { $gte: range.start, $lt: range.end } };
    const orderFilter: FilterQuery<OrderDocument> = { ...restaurantFilter, ...dateFilter };
    const paidOrderFilter: FilterQuery<OrderDocument> = { ...orderFilter, paymentStatus: PaymentStatus.PAID };
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
      this.aggregateSeries(normalizedPeriod, orderFilter),
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
      selectedDate: range.selectedDate,
      scope: isRestaurantScope ? 'restaurant' : 'system',
      balance: Number((balanceAgg as any)?.balance || 0),
      metrics,
      series: this.fillSeries(normalizedPeriod, range, series),
      topItems: topItems.map((item) => ({ menuItemId: item._id, name: item.name, quantity: item.quantity, revenue: item.revenue })),
      restaurantBalances: restaurantBalances.map((item: any) => ({
        restaurantId: item.ownerId,
        restaurantName: item.restaurant?.name || String(item.ownerId),
        logo: item.restaurant?.logo,
        balance: item.balance,
      })),
      refreshedAt: new Date(),
    };
  }
}
