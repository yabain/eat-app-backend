import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Payment, PaymentDocument } from '../../database/schemas/payment.schema';
import { BalanceTransaction, BalanceTransactionDocument } from '../../database/schemas/balance-transaction.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { DigikuntzProvider } from './providers/digikuntz.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { UserRole } from '../../common/enums/roles.enum';
import { MenuInventoryService } from '../menu/menu-inventory.service';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(BalanceTransaction.name) private balanceModel: Model<BalanceTransactionDocument>,
    private readonly inventory: MenuInventoryService,
    private provider: DigikuntzProvider,
    private notifications: NotificationsService,
  ) {}


  async list(actor: any, page?: number, limit?: number, filters?: { q?: string; status?: string; provider?: string; from?: string; to?: string }) {
    const pagination = normalizePagination(page, limit);
    const clauses: any[] = [];

    if ([UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role)) {
      const restaurantOrders = await this.orderModel.find({ restaurantId: actor.restaurantId }).select('_id');
      clauses.push({ orderId: { $in: restaurantOrders.map((order) => order._id) } });
    }

    if (filters?.status) clauses.push({ status: filters.status });
    if (filters?.provider) clauses.push({ provider: filters.provider });

    if (filters?.from || filters?.to) {
      const createdAt: any = {};
      if (filters.from) {
        const from = new Date(filters.from);
        if (!Number.isNaN(from.getTime())) createdAt.$gte = from;
      }
      if (filters.to) {
        const to = new Date(filters.to);
        if (!Number.isNaN(to.getTime())) createdAt.$lte = to;
      }
      if (Object.keys(createdAt).length) clauses.push({ createdAt });
    }

    const qRegex = buildContainsRegex(filters?.q);
    if (qRegex) {
      const matchingOrders = await this.orderModel.find({
        $or: [
          { orderNumber: qRegex },
          { orderStatus: qRegex },
          { paymentStatus: qRegex },
          { 'deliveryAddress.city': qRegex },
          { 'deliveryAddress.district': qRegex },
          { 'deliveryAddress.details': qRegex },
        ],
      }).select('_id');

      clauses.push({
        $or: [
          { provider: qRegex },
          { status: qRegex },
          { currency: qRegex },
          { providerRef: qRegex },
          { transactionRef: qRegex },
          { orderId: { $in: matchingOrders.map((order) => order._id) } },
        ],
      });
    }

    const filter = clauses.length ? { $and: clauses } : {};
    const [data, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .populate({
          path: 'orderId',
          populate: [
            { path: 'restaurantId' },
            { path: 'userId', select: 'firstName lastName email phone profileImage role restaurantId isActive' },
          ],
        })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.paymentModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  private refId(ref: any): string {
    if (!ref) return '';
    if (typeof ref === 'string') return ref;
    return String(ref._id || ref.id || ref);
  }

  private assertOrderAccess(order: OrderDocument | any, actor: any) {
    if (actor.role === UserRole.ADMIN) return;
    if (actor.role === UserRole.CLIENT && this.refId(order.userId) === String(actor.sub)) return;
    if (
      [UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role)
      && this.refId(order.restaurantId) === this.refId(actor.restaurantId)
    ) return;
    throw new ForbiddenException('You are not allowed to access this order payment');
  }

  private buildCheckoutFromPayment(payment: any, remote?: any) {
    const remoteData = remote?.data || {};
    return {
      providerRef: payment.providerRef || remote?.id,
      transactionRef: payment.transactionRef || remoteData.transactionRef,
      amount: payment.amount || remoteData.estimation,
      paymentWithTaxes: payment.paymentWithTaxes ?? remoteData.paymentWithTaxes,
      invoiceTaxes: payment.invoiceTaxes ?? remoteData.invoiceTaxes,
      paymentLink: payment.paymentLink || remoteData.paymentLink,
      status: remote?.status || 'payin_pending',
    };
  }

  private findOrderByIdOrNumber(orderRef: string) {
    const filter = isValidObjectId(orderRef)
      ? { $or: [{ _id: orderRef }, { orderNumber: orderRef }] }
      : { orderNumber: orderRef };
    return this.orderModel.findOne(filter);
  }


  async findOne(id: string, actor: any) {
    const payment = await this.paymentModel
      .findById(id)
      .populate({
        path: 'orderId',
        populate: [
          { path: 'restaurantId' },
          { path: 'userId', select: 'firstName lastName email phone profileImage role restaurantId isActive' },
          { path: 'assignedDriverId', select: 'firstName lastName email phone profileImage role restaurantId isActive' },
        ],
      });
    if (!payment) throw new NotFoundException('Payment not found');

    const order = payment.orderId as any;
    if (order && typeof order === 'object') this.assertOrderAccess(order, actor);
    return payment;
  }

  async initiate(orderId: string, actor: any) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    this.assertOrderAccess(order, actor);
    if (order.paymentStatus === PaymentStatus.PAID) throw new BadRequestException('Order already paid');

    const existingPayment = await this.paymentModel
      .findOne({ orderId: order._id, status: PaymentStatus.PROCESSING })
      .sort({ createdAt: -1 });

    if (existingPayment) {
      const remote = existingPayment.providerRef
        ? await this.provider.getTransactionStatus(existingPayment.providerRef)
        : null;

      if (remote && remote.status !== 'payin_pending') {
        await this.applyPayinStatus(existingPayment, order, remote.status, remote);
        if (remote.status === 'payin_success') throw new BadRequestException('Order already paid');
      } else {
        const checkout = this.buildCheckoutFromPayment(existingPayment, remote);
        if (checkout.paymentLink) {
          return {
            payment: existingPayment,
            checkout,
          };
        }
      }
    }

    const user = await this.userModel.findById(order.userId);
    const response = await this.provider.initiatePayment(
      order.orderNumber,
      order.pricingSnapshot.grandTotal,
      user?.phone,
      user?.email,
    );

    const payment = await this.paymentModel.create({
      orderId: order._id,
      amount: order.pricingSnapshot.grandTotal,
      provider: 'digikuntz',
      currency: 'XAF',
      status: PaymentStatus.PROCESSING,
      providerRef: response.providerRef,
      transactionRef: response.transactionRef,
      paymentLink: response.paymentLink,
      paymentWithTaxes: response.paymentWithTaxes,
      invoiceTaxes: response.invoiceTaxes,
      initiatedAt: new Date(),
    });

    order.paymentStatus = PaymentStatus.PROCESSING;
    await order.save();

    return { payment, checkout: response };
  }

  async paymentStatus(orderId: string, actor: any) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    this.assertOrderAccess(order, actor);
    return this.paymentModel.findOne({ orderId }).sort({ createdAt: -1 });
  }

  async syncOrderPayment(orderRef: string, actor: any) {
    const order = await this.findOrderByIdOrNumber(orderRef);
    if (!order) throw new NotFoundException('Order not found');
    this.assertOrderAccess(order, actor);

    if (![PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.FAILED].includes(order.paymentStatus as PaymentStatus)) {
      throw new BadRequestException('Only pending, processing or failed payments can be synced');
    }

    const payment = await this.paymentModel
      .findOne({
        orderId: order._id,
        status: { $in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.FAILED, PaymentStatus.PAID] },
        providerRef: { $exists: true, $ne: null },
      })
      .sort({ createdAt: -1 });
    if (!payment) throw new NotFoundException('No DigiKuntz transaction found for this order');

    const remote = await this.provider.getTransactionStatus(payment.providerRef);
    if (!remote) throw new BadRequestException('Unable to fetch DigiKuntz transaction status');

    await this.applyPayinStatus(payment, order, remote.status, remote);

    return {
      order,
      payment,
      remoteStatus: remote.status,
      checkout: this.buildCheckoutFromPayment(payment, remote),
    };
  }

  async webhook(payload: any) {
    // DigiKuntz envoie { id, status, data }
    const payment = await this.paymentModel.findOne({ providerRef: payload.id });
    if (!payment) throw new NotFoundException('Payment not found');

    const order = await this.orderModel.findById(payment.orderId);
    if (!order) throw new NotFoundException('Order not found');

    await this.applyPayinStatus(payment, order, payload.status, payload);
    return { ok: true };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncPendingPayments() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const pendingPayments = await this.paymentModel.find({
      status: PaymentStatus.PROCESSING,
      initiatedAt: { $lte: fiveMinutesAgo },
    });

    for (const payment of pendingPayments) {
      if (!payment.providerRef) continue;
      const remote = await this.provider.getTransactionStatus(payment.providerRef);
      if (!remote || remote.status === 'payin_pending') continue;

      const order = await this.orderModel.findById(payment.orderId);
      if (!order) continue;

      await this.applyPayinStatus(payment, order, remote.status, remote);
    }
  }


  private restaurantBalanceAmount(order: any): number {
    const pricing = order.pricingSnapshot || {};
    const grandTotal = Number(pricing.grandTotal || 0);
    const platformFee = Number(pricing.platformFee || 0);
    return Math.max(0, grandTotal - platformFee);
  }

  private async creditRestaurantBalance(order: any, payment: any) {
    const amount = this.restaurantBalanceAmount(order);
    if (!amount || !order.restaurantId || !payment?._id) return;
    await this.balanceModel.updateOne(
      { paymentId: payment._id },
      {
        $setOnInsert: {
          ownerType: 'restaurant',
          restaurantId: order.restaurantId,
          orderId: order._id,
          paymentId: payment._id,
          amount,
          type: 'credit',
          reason: 'order_payment',
          currency: payment.currency || 'XAF',
        },
      },
      { upsert: true },
    );
  }

  private async applyPayinStatus(payment: any, order: any, status: string, payload: any) {
    const pending = status === 'payin_pending';
    const success = status === 'payin_success';
    const failed = ['payin_error', 'payin_closed'].includes(status);
    if (!pending && !success && !failed) return;
    if (payment.status === PaymentStatus.PAID && !success) return;

    const wasAlreadyPaid = payment.status === PaymentStatus.PAID;

    payment.status = pending
      ? PaymentStatus.PROCESSING
      : success
        ? PaymentStatus.PAID
        : PaymentStatus.FAILED;
    payment.callbackPayload = payload;
    if (!pending) payment.completedAt = new Date();
    await payment.save();

    order.paymentStatus = payment.status;
    order.orderStatus = pending
      ? OrderStatus.PENDING_PAYMENT
      : success
        ? OrderStatus.PAID
        : OrderStatus.PAYMENT_FAILED;
    await order.save();

    if (success && !wasAlreadyPaid) {
      await this.creditRestaurantBalance(order, payment);
      await Promise.all(
        order.items.map((item: any) =>
          this.inventory.adjustStock(item.menuItemId, -item.quantity),
        ),
      );
      const user = await this.userModel.findById(order.userId);
      if (user) await this.notifications.sendOrderConfirmed(user.email, user.phone, order.orderNumber);
    }
  }
}
