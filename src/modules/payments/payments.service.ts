import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { timingSafeEqual } from 'crypto';
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
  private readonly logger = new Logger(PaymentsService.name);

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

  async webhook(payload: any, providedToken?: string) {
    this.assertWebhookAuthenticated(providedToken);

    if (!payload?.id) throw new BadRequestException('Missing transaction id');

    const payment = await this.paymentModel.findOne({ providerRef: payload.id });
    if (!payment) throw new NotFoundException('Payment not found');

    // Idempotence stricte : une transaction PAID ou FAILED ne doit pas être rejouée
    // par un retry de DigiKuntz qui voudrait nous renvoyer un autre statut.
    if (payment.status === PaymentStatus.PAID) return { ok: true, idempotent: true };
    if (payment.status === PaymentStatus.FAILED && ['payin_error', 'payin_closed'].includes(payload.status)) {
      return { ok: true, idempotent: true };
    }

    // Trust but verify : on ne fait pas confiance au payload du webhook,
    // on réinterroge DigiKuntz pour obtenir le vrai statut.
    const remote = await this.provider.getTransactionStatus(payload.id);
    if (!remote) {
      this.logger.error(`Webhook received for ${payload.id} but DigiKuntz status fetch failed`);
      throw new ServiceUnavailableException('Unable to verify DigiKuntz transaction status');
    }

    if (remote.id && String(remote.id) !== String(payload.id)) {
      this.logger.error(`Webhook id mismatch: payload=${payload.id} remote=${remote.id}`);
      throw new BadRequestException('Transaction id mismatch');
    }

    const remoteAmount = this.extractRemoteAmount(remote);
    const expectedAmount = Number(payment.amount);
    if (
      !Number.isFinite(expectedAmount)
      || remoteAmount === null
      || Math.abs(remoteAmount - expectedAmount) > 0.5
    ) {
      this.logger.error(
        `Webhook amount mismatch for payment ${payment._id}: expected=${expectedAmount} remote=${remoteAmount}`,
      );
      throw new BadRequestException('Payment amount mismatch');
    }

    const order = await this.orderModel.findById(payment.orderId);
    if (!order) throw new NotFoundException('Order not found');

    await this.applyPayinStatus(payment, order, remote.status, remote);
    return { ok: true };
  }

  private assertWebhookAuthenticated(providedToken?: string) {
    const expected = process.env.DIGIKUNTZ_WEBHOOK_SECRET;
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('DIGIKUNTZ_WEBHOOK_SECRET is not configured — refusing webhook in production');
        throw new UnauthorizedException('Webhook authentication is not configured');
      }
      this.logger.warn('DIGIKUNTZ_WEBHOOK_SECRET is not configured — webhook is unauthenticated (dev mode only)');
      return;
    }
    if (!providedToken || !this.constantTimeEquals(providedToken, expected)) {
      this.logger.warn('Rejected DigiKuntz webhook with invalid or missing token');
      throw new UnauthorizedException('Invalid webhook token');
    }
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }

  private extractRemoteAmount(remote: any): number | null {
    const candidates = [
      remote?.data?.estimation,
      remote?.data?.amount,
      remote?.data?.paymentWithTaxes,
      remote?.amount,
    ];
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) continue;
      const value = Number(candidate);
      if (Number.isFinite(value)) return value;
    }
    return null;
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

    await this.expireStalePendingOrders();
  }

  private getOrderPaymentTimeoutMs(): number {
    const minutes = Number(process.env.ORDER_PAYMENT_TIMEOUT_MINUTES);
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
    return safeMinutes * 60 * 1000;
  }

  /**
   * Annule les commandes restées en PENDING_PAYMENT au-delà du TTL et restitue
   * leur stock. Avant d'annuler, on tente une dernière vérification auprès de
   * DigiKuntz pour éviter d'écraser un paiement réussi tardivement (mobile money
   * peut prendre plusieurs minutes).
   */
  private async expireStalePendingOrders() {
    const cutoff = new Date(Date.now() - this.getOrderPaymentTimeoutMs());
    const staleOrders = await this.orderModel.find({
      orderStatus: OrderStatus.PENDING_PAYMENT,
      createdAt: { $lt: cutoff },
    });

    for (const order of staleOrders) {
      try {
        const latestPayment = await this.paymentModel
          .findOne({ orderId: order._id })
          .sort({ createdAt: -1 });

        if (latestPayment?.providerRef) {
          const remote = await this.provider.getTransactionStatus(latestPayment.providerRef);
          if (remote && remote.status !== 'payin_pending') {
            // Issue connue par le provider — laisser applyPayinStatus gérer
            // (succès tardif OU échec déjà confirmé, qui restituera le stock).
            await this.applyPayinStatus(latestPayment, order, remote.status, remote);
            continue;
          }
        }

        await this.expireOrderForTimeout(order, latestPayment);
      } catch (err: any) {
        this.logger.error(`Failed to expire stale order ${order._id}: ${err?.message || err}`);
      }
    }
  }

  private async expireOrderForTimeout(order: any, payment: any | null) {
    // Transition atomique : seul le run qui flip PENDING_PAYMENT -> PAYMENT_FAILED
    // restitue le stock. Tout autre run concurrent (ou re-run après crash partiel)
    // verra `transitioned === null` et n'agira pas → pas de double restitution.
    const transitioned = await this.orderModel.findOneAndUpdate(
      { _id: order._id, orderStatus: OrderStatus.PENDING_PAYMENT },
      { $set: { orderStatus: OrderStatus.PAYMENT_FAILED, paymentStatus: PaymentStatus.FAILED } },
      { new: true },
    );
    if (!transitioned) return;

    if (payment && payment.status !== PaymentStatus.FAILED && payment.status !== PaymentStatus.PAID) {
      payment.status = PaymentStatus.FAILED;
      payment.completedAt = new Date();
      payment.callbackPayload = {
        ...(payment.callbackPayload || {}),
        expiredAt: new Date(),
        reason: 'payment_timeout',
      };
      await payment.save();
    }

    await Promise.all(
      (transitioned.items || []).map((item: any) =>
        this.inventory
          .adjustStock(item.menuItemId, Number(item.quantity) || 0)
          .catch((err) => {
            this.logger.error(
              `Failed to restore stock for expired order ${transitioned._id} item ${item.menuItemId}: ${err?.message || err}`,
            );
          }),
      ),
    );

    this.logger.log(
      `Order ${transitioned.orderNumber} expired (PENDING_PAYMENT > ${process.env.ORDER_PAYMENT_TIMEOUT_MINUTES || 30}min) — stock restored`,
    );
  }


  private orderBalanceDistribution(order: any) {
    const pricing = order.pricingSnapshot || {};
    const grandTotal = Number(pricing.grandTotal || 0);
    const platformFee = Number(pricing.platformFee || 0);
    const deliveryFee = Number(pricing.deliveryFee || 0);
    const packagingTotal = Number(pricing.packagingTotal || 0);

    return {
      systemAmount: Math.max(0, platformFee + packagingTotal + deliveryFee * 0.25),
      restaurantAmount: Math.max(0, grandTotal - platformFee - deliveryFee - packagingTotal),
    };
  }

  private async creditOrderBalances(order: any, payment: any) {
    if (!payment?._id) return;
    const { systemAmount, restaurantAmount } = this.orderBalanceDistribution(order);
    const currency = payment.currency || 'XAF';
    const operations: Promise<any>[] = [];

    if (systemAmount > 0) {
      operations.push(this.balanceModel.updateOne(
        { paymentId: payment._id, ownerType: 'system', reason: 'order_system_share' },
        {
          $setOnInsert: {
            ownerType: 'system',
            orderId: order._id,
            paymentId: payment._id,
            amount: systemAmount,
            type: 'credit',
            reason: 'order_system_share',
            note: 'Platform fee + packaging fees + 25% delivery fee',
            currency,
          },
        },
        { upsert: true },
      ));
    }

    if (restaurantAmount > 0 && order.restaurantId) {
      operations.push(this.balanceModel.updateOne(
        { paymentId: payment._id, ownerType: 'restaurant', restaurantId: order.restaurantId, reason: 'order_restaurant_share' },
        {
          $setOnInsert: {
            ownerType: 'restaurant',
            restaurantId: order.restaurantId,
            orderId: order._id,
            paymentId: payment._id,
            amount: restaurantAmount,
            type: 'credit',
            reason: 'order_restaurant_share',
            note: 'Order total minus platform, delivery and packaging fees',
            currency,
          },
        },
        { upsert: true },
      ));
    }

    await Promise.all(operations);
  }

  private async applyPayinStatus(payment: any, order: any, status: string, payload: any) {
    const pending = status === 'payin_pending';
    const success = status === 'payin_success';
    const failed = ['payin_error', 'payin_closed'].includes(status);
    if (!pending && !success && !failed) return;
    if (payment.status === PaymentStatus.PAID && !success) return;

    const wasAlreadyPaid = payment.status === PaymentStatus.PAID;
    const wasAlreadyFailed = payment.status === PaymentStatus.FAILED;

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
      // Stock déjà décrémenté dans la transaction de création de commande
      // (cf. OrdersService.placeOrderWithinSession). On ne re-décrémente pas ici.
      await this.creditOrderBalances(order, payment);
      const user = await this.userModel.findById(order.userId);
      if (user) await this.notifications.sendOrderConfirmed(user.email, user.phone, order.orderNumber);
    }

    if (failed && !wasAlreadyFailed && !wasAlreadyPaid) {
      // Restitution du stock réservé à la création de la commande
      await Promise.all(
        (order.items || []).map((item: any) =>
          this.inventory.adjustStock(item.menuItemId, Number(item.quantity) || 0).catch((err) => {
            this.logger.error(
              `Failed to restore stock for order ${order._id} item ${item.menuItemId}: ${err?.message || err}`,
            );
          }),
        ),
      );
    }
  }
}
