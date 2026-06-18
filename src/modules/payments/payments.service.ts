import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { timingSafeEqual } from 'crypto';
import { Payment, PaymentDocument } from '../../database/schemas/payment.schema';
import { Balance, BalanceDocument, BalanceAccountType } from '../../database/schemas/balance.schema';
import { BalanceTransaction, BalanceTransactionDocument } from '../../database/schemas/balance-transaction.schema';
import { WithdrawalRequest, WithdrawalRequestDocument } from '../../database/schemas/withdrawal-request.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { DigikuntzProvider } from './providers/digikuntz.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { CronLeaseService } from '../../common/cron-lease/cron-lease.service';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { UserRole } from '../../common/enums/roles.enum';
import { MenuInventoryService } from '../menu/menu-inventory.service';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';
import { buildTimeSeriesStats } from '../../common/stats/time-series-stats';

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private isSyncingProviderPayments = false;

  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(Balance.name) private balanceModel: Model<BalanceDocument>,
    @InjectModel(BalanceTransaction.name) private transactionModel: Model<BalanceTransactionDocument>,
    @InjectModel(WithdrawalRequest.name) private withdrawalModel: Model<WithdrawalRequestDocument>,
    private readonly inventory: MenuInventoryService,
    private provider: DigikuntzProvider,
    private notifications: NotificationsService,
    private readonly cronLease: CronLeaseService,
  ) {}

  async onModuleInit() {
    await this.ensureBalanceTransactionIndexes();
    await this.ensureOpenPaymentIndex();
  }

  private async ensureOpenPaymentIndex() {
    const name = 'open_order_payment_unique';
    try {
      const duplicates = await this.paymentModel.aggregate([
        { $match: { status: PaymentStatus.PROCESSING } },
        { $group: { _id: '$orderId', ids: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ]);

      for (const duplicate of duplicates) {
        const payments = await this.paymentModel
          .find({ _id: { $in: duplicate.ids } })
          .sort({ initiatedAt: -1, createdAt: -1 });
        const keeper = payments.find((payment) => payment.providerRef || payment.paymentLink) || payments[0];
        const obsoleteIds = payments
          .filter((payment) => String(payment._id) !== String(keeper?._id))
          .map((payment) => payment._id);
        if (obsoleteIds.length) {
          this.logger.warn(
            `Reconciling ${obsoleteIds.length} duplicate open payment(s) for order ${duplicate._id}`,
          );
          await this.paymentModel.updateMany(
            { _id: { $in: obsoleteIds }, status: PaymentStatus.PROCESSING },
            {
              $set: {
                status: PaymentStatus.FAILED,
                completedAt: new Date(),
                callbackPayload: { reason: 'duplicate_open_payment_reconciled' },
              },
            },
          );
        }
      }

      const indexes = await this.paymentModel.collection.indexes();
      const existing = indexes.find((index: any) => index.name === name);
      const expectedPartial = JSON.stringify({ status: PaymentStatus.PROCESSING });
      const currentPartial = JSON.stringify(existing?.partialFilterExpression || null);
      if (existing && (!existing.unique || currentPartial !== expectedPartial)) {
        await this.paymentModel.collection.dropIndex(name);
      }
      if (!existing || !existing.unique || currentPartial !== expectedPartial) {
        await this.paymentModel.collection.createIndex(
          { orderId: 1 },
          {
            name,
            unique: true,
            partialFilterExpression: { status: PaymentStatus.PROCESSING },
          },
        );
      }
    } catch (error: any) {
      this.logger.error(`Unable to ensure open payment index: ${error?.message || error}`);
      throw error;
    }
  }

  private async ensureBalanceTransactionIndexes() {
    await this.dropLegacyBalanceTransactionIndexes();
    await this.ensurePartialObjectIdIndex(
      'withdrawalId_1_reason_1',
      { withdrawalId: 1, reason: 1 },
      { withdrawalId: { $type: 'objectId' } },
    );
    await this.ensurePartialObjectIdIndex(
      'paymentId_1_ownerType_1_restaurantId_1_userId_1_reason_1',
      { paymentId: 1, ownerType: 1, restaurantId: 1, userId: 1, reason: 1 },
      { paymentId: { $type: 'objectId' } },
    );
  }

  private async dropLegacyBalanceTransactionIndexes() {
    const legacyIndexNames = ['paymentId_1'];
    try {
      const indexes = await this.transactionModel.collection.indexes();
      for (const name of legacyIndexNames) {
        if (!indexes.some((index: any) => index.name === name)) continue;
        await this.transactionModel.collection.dropIndex(name);
        this.logger.log(`Dropped legacy balance transaction index: ${name}`);
      }
    } catch (error: any) {
      this.logger.warn(`Unable to drop legacy balance transaction indexes: ${error?.message || error}`);
    }
  }

  private async ensurePartialObjectIdIndex(name: string, keys: Record<string, 1 | -1>, partialFilterExpression: any) {
    try {
      const indexes = await this.transactionModel.collection.indexes();
      const existing = indexes.find((index: any) => index.name === name);
      const expectedPartial = JSON.stringify(partialFilterExpression);
      const currentPartial = JSON.stringify(existing?.partialFilterExpression || null);

      if (existing && currentPartial !== expectedPartial) {
        await this.transactionModel.collection.dropIndex(name);
      }

      if (!existing || currentPartial !== expectedPartial) {
        await this.transactionModel.collection.createIndex(keys, {
          name,
          unique: true,
          partialFilterExpression,
        });
        this.logger.log(`Balance transaction index ready: ${name}`);
      }
    } catch (error: any) {
      this.logger.warn(`Unable to ensure balance transaction index ${name}: ${error?.message || error}`);
    }
  }


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
            { path: 'userId', select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable' },
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

  async stats(actor: any, period?: string, date?: string) {
    let filter: any = {};
    if ([UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role)) {
      const restaurantOrders = await this.orderModel.find({ restaurantId: actor.restaurantId }).select('_id');
      filter.orderId = { $in: restaurantOrders.map((order) => order._id) };
    }
    return buildTimeSeriesStats(this.paymentModel, period, date, filter);
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

  private money(value: any): number {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 0;
    return Math.max(0, Math.floor(amount));
  }

  private balanceInteger(value: any): number {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 0;
    const sign = amount < 0 ? -1 : 1;
    return sign * Math.floor(Math.abs(amount));
  }

  private orderPaymentAmount(order: any): number {
    const pricing = order?.pricingSnapshot || {};
    const explicit = Number(pricing.paymentAmount);
    if (Number.isFinite(explicit) && explicit > 0) return this.money(explicit);

    const itemsSubtotal = Number(pricing.itemsSubtotal);
    const packagingTotal = Number(pricing.packagingTotal);
    const deliveryFee = Number(pricing.deliveryFee);
    const promoDiscount = Number(pricing.promoDiscount || 0);
    if ([itemsSubtotal, packagingTotal, deliveryFee].every(Number.isFinite)) {
      return this.money(itemsSubtotal + packagingTotal + deliveryFee - promoDiscount);
    }

    return this.money(Number(pricing.grandTotal || 0) - Number(pricing.platformFee || 0));
  }

  private cameroonDateKey(date: Date | string | number): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Douala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(date));
  }

  private isOrderFromCurrentCameroonDay(order: any): boolean {
    if (!order?.createdAt) return false;
    return this.cameroonDateKey(order.createdAt) === this.cameroonDateKey(new Date());
  }


  async findOne(id: string, actor: any) {
    const payment = await this.paymentModel
      .findById(id)
      .populate({
        path: 'orderId',
        populate: [
          { path: 'restaurantId' },
          { path: 'userId', select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable' },
          { path: 'assignedDriverId', select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable' },
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
    if (!this.isOrderFromCurrentCameroonDay(order)) {
      throw new BadRequestException('Le paiement est autorisé uniquement pour les commandes du jour.');
    }

    const existingPayment = await this.paymentModel
      .findOne({ orderId: order._id, status: PaymentStatus.PROCESSING })
      .sort({ createdAt: -1 });

    if (existingPayment) {
      const reused = await this.reuseProcessingPayment(existingPayment, order);
      if (reused) return reused;
    }

    const user = await this.userModel.findById(order.userId);
    const paymentAmount = this.orderPaymentAmount(order);
    if (paymentAmount <= 0) throw new BadRequestException('Invalid order payment amount');

    let payment: PaymentDocument;
    try {
      payment = await this.paymentModel.create({
        orderId: order._id,
        amount: paymentAmount,
        provider: 'digikuntz',
        currency: 'XAF',
        status: PaymentStatus.PROCESSING,
        initiatedAt: new Date(),
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const concurrentPayment = await this.paymentModel
        .findOne({ orderId: order._id, status: PaymentStatus.PROCESSING })
        .sort({ createdAt: -1 });
      if (!concurrentPayment) throw new ConflictException('Une initiation de paiement est déjà en cours');
      const reused = await this.reuseProcessingPayment(concurrentPayment, order, true);
      if (reused) return reused;
      throw new ConflictException('Une initiation de paiement est déjà en cours');
    }

    try {
      const response = await this.provider.initiatePayment(
        order.orderNumber,
        paymentAmount,
        user?.phone,
        user?.email,
      );

      payment.providerRef = response.providerRef;
      payment.transactionRef = response.transactionRef;
      payment.paymentLink = response.paymentLink;
      payment.paymentWithTaxes = response.paymentWithTaxes;
      payment.invoiceTaxes = response.invoiceTaxes;
      await payment.save();

      order.paymentStatus = PaymentStatus.PROCESSING;
      await order.save();

      return { payment, checkout: response };
    } catch (error: any) {
      // Gateway DigiKuntz indisponible → on supprime le Payment temporaire
      // pour ne laisser AUCUNE trace en base (rien à réessayer, rien à
      // historiser) et on remonte une erreur 503 explicite au client.
      if (error instanceof ServiceUnavailableException) {
        await this.paymentModel.deleteOne({
          _id: payment._id,
          status: PaymentStatus.PROCESSING,
          providerRef: { $exists: false },
        });
        throw new ServiceUnavailableException(
          'Le service de paiement est temporairement indisponible. Réessayez dans quelques minutes.',
        );
      }
      // Autres erreurs (validation provider, 4xx…) : on garde le Payment
      // en FAILED pour audit.
      await this.paymentModel.updateOne(
        { _id: payment._id, status: PaymentStatus.PROCESSING },
        {
          $set: {
            status: PaymentStatus.FAILED,
            completedAt: new Date(),
            callbackPayload: {
              reason: 'provider_initiation_failed',
              error: error?.message || String(error),
            },
          },
        },
      );
      throw error;
    }
  }

  private async reuseProcessingPayment(
    initialPayment: PaymentDocument,
    order: OrderDocument,
    waitForInitialization = false,
  ) {
    let payment = initialPayment;
    if (waitForInitialization && !payment.providerRef && !payment.paymentLink) {
      payment = await this.waitForPaymentInitialization(payment._id);
    }

    if (!payment.providerRef && !payment.paymentLink) {
      const initiatedAt = new Date((payment as any).initiatedAt || (payment as any).createdAt || 0).getTime();
      const staleAfterMs = Math.max(
        60,
        Number(process.env.PAYMENT_INITIATION_LOCK_SECONDS || 300),
      ) * 1000;
      if (initiatedAt && Date.now() - initiatedAt >= staleAfterMs) {
        const released = await this.paymentModel.findOneAndUpdate(
          {
            _id: payment._id,
            status: PaymentStatus.PROCESSING,
            providerRef: { $exists: false },
            paymentLink: { $exists: false },
          },
          {
            $set: {
              status: PaymentStatus.FAILED,
              completedAt: new Date(),
              callbackPayload: { reason: 'stale_payment_initiation_lock' },
            },
          },
          { new: true },
        );
        if (released) return null;
      }
      throw new ConflictException('Une initiation de paiement est déjà en cours. Réessayez dans quelques secondes.');
    }

    const remote = payment.providerRef
      ? await this.provider.getTransactionStatus(payment.providerRef)
      : null;

    if (remote && remote.status !== 'payin_pending') {
      await this.applyPayinStatus(payment, order, remote.status, remote);
      if (remote.status === 'payin_success') throw new BadRequestException('Order already paid');
      return null;
    }

    const checkout = this.buildCheckoutFromPayment(payment, remote);
    if (!checkout.paymentLink) {
      throw new ConflictException('Le lien de paiement est en cours de génération. Réessayez dans quelques secondes.');
    }
    return { payment, checkout };
  }

  private async waitForPaymentInitialization(paymentId: any): Promise<PaymentDocument> {
    const attempts = 20;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const payment = await this.paymentModel.findById(paymentId);
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status !== PaymentStatus.PROCESSING || payment.providerRef || payment.paymentLink) {
        return payment;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const payment = await this.paymentModel.findById(paymentId);
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
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

  async webhook(payload: any, providedToken?: string, options: { allowMissingToken?: boolean } = {}) {
    this.assertWebhookAuthenticated(providedToken, options.allowMissingToken);

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

  private assertWebhookAuthenticated(providedToken?: string, allowMissingToken = false) {
    const expected = process.env.DIGIKUNTZ_WEBHOOK_SECRET;
    if (allowMissingToken && !providedToken) return;
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

  @Cron(CronExpression.EVERY_MINUTE)
  async syncPendingPayments() {
    if (!(await this.cronLease.acquire('payments.syncPending', 50 * 1000))) return;
    if (this.isSyncingProviderPayments) {
      this.logger.debug('DigiKuntz payment sync already running, skipping');
      return;
    }

    this.isSyncingProviderPayments = true;
    try {
      const limit = Number(process.env.DIGIKUNTZ_SYNC_BATCH_LIMIT || 100);
      const pendingPayments = await this.paymentModel
        .find({
          provider: 'digikuntz',
          status: { $in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
          providerRef: { $exists: true, $ne: null },
        })
        .sort({ updatedAt: 1 })
        .limit(Number.isFinite(limit) && limit > 0 ? limit : 100);

      for (const payment of pendingPayments) {
        try {
          const remote = await this.provider.getTransactionStatus(payment.providerRef || '');
          if (!remote) continue;

          const order = await this.orderModel.findById(payment.orderId);
          if (!order) continue;

          await this.applyPayinStatus(payment, order, remote.status, remote);
        } catch (err: any) {
          this.logger.warn(`Failed to sync DigiKuntz payment ${payment._id}: ${err?.message || err}`);
        }
      }

      await this.expireStalePendingOrders();
    } finally {
      this.isSyncingProviderPayments = false;
    }
  }

  private getOrderPaymentTimeoutMs(): number {
    const minutes = Number(process.env.ORDER_PAYMENT_TIMEOUT_MINUTES || process.env.PAYMENT_TIMEOUT_MINUTES);
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
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

    await this.restoreReservedStockIfCurrentCameroonDay(transitioned, 'payment_timeout');

    this.logger.log(
      `Order ${transitioned.orderNumber} expired (PENDING_PAYMENT > ${process.env.ORDER_PAYMENT_TIMEOUT_MINUTES || 10}min)`,
    );
  }

  private async restoreReservedStockIfCurrentCameroonDay(order: any, reason: string) {
    if (!this.isOrderFromCurrentCameroonDay(order)) {
      this.logger.warn(
        `Stock restoration skipped for order ${order._id} (${reason}): order date is not current Cameroon day`,
      );
      return { restored: false, skipped: true, failures: [] as string[] };
    }

    const failures: string[] = [];
    for (const item of order.items || []) {
      try {
        const restored = await this.inventory.adjustStock(item.menuItemId, Number(item.quantity) || 0);
        if (!restored) {
          failures.push(String(item.menuItemId));
          this.logger.error(
            `Failed to restore stock for order ${order._id} item ${item.menuItemId}: menu item not found`,
          );
        }
      } catch (err: any) {
        failures.push(String(item.menuItemId));
        this.logger.error(
          `Failed to restore stock for order ${order._id} item ${item.menuItemId}: ${err?.message || err}`,
        );
      }
    }
    return { restored: failures.length === 0, skipped: false, failures };
  }


  private orderBalanceDistribution(order: any) {
    const pricing = order.pricingSnapshot || {};
    const paymentAmount = this.orderPaymentAmount(order);
    const deliveryFee = this.money(pricing.deliveryFee);
    const packagingTotal = this.money(pricing.packagingTotal);
    const distributionVersion = Number(pricing.balanceDistributionVersion || 1);

    if (distributionVersion >= 2) {
      const itemsSubtotal = this.money(pricing.itemsSubtotal);
      const promoDiscount = this.money(pricing.promoDiscount);
      const categorySystemFeeTotal = this.money(
        pricing.categorySystemFeeTotal ??
        (order.items || []).reduce(
          (sum: number, item: any) =>
            sum + Number(item.systemFeeTotal ?? Number(item.systemFeePerItem || 0) * Number(item.quantity || 0)),
          0,
        ),
      );
      const driverAmount = this.money(deliveryFee * 0.85);
      const systemDeliveryShare = this.money(deliveryFee * 0.15);

      return {
        systemAmount: this.money(categorySystemFeeTotal + systemDeliveryShare),
        restaurantAmount: this.money(
          itemsSubtotal + packagingTotal - promoDiscount - categorySystemFeeTotal,
        ),
        driverAmount,
        distributionVersion,
      };
    }

    const driverAmount = this.money(deliveryFee * 0.75);
    const systemDeliveryShare = Math.max(0, deliveryFee - driverAmount);
    return {
      systemAmount: this.money(packagingTotal + systemDeliveryShare),
      restaurantAmount: this.money(paymentAmount - deliveryFee - packagingTotal),
      driverAmount,
      distributionVersion,
    };
  }

  private balanceAccountFromTransactionPayload(payload: any): { accountType: BalanceAccountType; ownerId: string } {
    if (payload.ownerType === 'restaurant') {
      return { accountType: 'restaurant', ownerId: String(payload.restaurantId) };
    }
    if (payload.ownerType === 'user') {
      return { accountType: 'driver', ownerId: String(payload.userId) };
    }
    return { accountType: 'system', ownerId: '0000000' };
  }

  private async getBalanceTotalFromTransactions(payload: any): Promise<number> {
    const match = payload.ownerType === 'restaurant'
      ? { ownerType: 'restaurant', restaurantId: payload.restaurantId }
      : payload.ownerType === 'user'
        ? { ownerType: 'user', userId: payload.userId }
        : { ownerType: 'system' };

    const [row] = await this.transactionModel.aggregate([
      { $match: match },
      { $group: { _id: null, balance: { $sum: '$amount' } } },
    ]);
    return this.balanceInteger(row?.balance || 0);
  }

  private async setBalanceTotal(payload: any): Promise<number> {
    const account = this.balanceAccountFromTransactionPayload(payload);
    // Le ledger BalanceTransaction est l'unique source de vérité :
    // retrait initié => débit withdrawal_request ; retrait échoué => refund.
    // Une réconciliation paiement ne doit jamais recréditer un retrait pending.
    const balance = await this.computeAuthoritativeBalance(payload);
    await this.balanceModel.findOneAndUpdate(
      account,
      {
        $set: {
          ...account,
          balance,
          currency: payload.currency || 'XAF',
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    return balance;
  }

  private async computeAuthoritativeBalance(payload: any): Promise<number> {
    const btsMatch: any = {
      ownerType: payload.ownerType,
    };
    if (payload.ownerType === 'restaurant') {
      btsMatch.restaurantId = payload.restaurantId;
    } else if (payload.ownerType === 'user') {
      btsMatch.userId = payload.userId;
    }

    const [btRow] = await this.transactionModel.aggregate([
      { $match: btsMatch },
      {
        $lookup: {
          from: this.withdrawalModel.collection.name,
          localField: 'withdrawalId',
          foreignField: '_id',
          as: 'withdrawal',
        },
      },
      {
        $addFields: {
          withdrawalStatus: { $arrayElemAt: ['$withdrawal.status', 0] },
        },
      },
      {
        $match: {
          $or: [
            { reason: { $ne: 'withdrawal_refund' } },
            { withdrawalStatus: { $in: ['failed', 'rejected'] } },
          ],
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    return this.balanceInteger(Number(btRow?.total || 0));
  }

  private async recordOrderBalanceTransaction(filter: any, payload: any) {
    const amount = this.money(payload.amount);
    const doc = {
      ...payload,
      amount,
      currency: payload.currency || 'XAF',
    };
    const { amount: _amount, note: _note, currency: _currency, ...insertOnlyDoc } = doc;

    await this.transactionModel.updateOne(
      filter,
      {
        $setOnInsert: {
          ...insertOnlyDoc,
          createdAt: new Date(),
        },
        $set: {
          amount,
          note: doc.note,
          currency: doc.currency,
        },
      },
      { upsert: true },
    );

    return this.setBalanceTotal(doc);
  }

  private async creditOrderBalances(order: any, payment: any, driverId?: any) {
    if (!payment?._id) return;
    const { systemAmount, restaurantAmount, driverAmount, distributionVersion } = this.orderBalanceDistribution(order);
    const currency = payment.currency || 'XAF';
    const operations: Promise<any>[] = [];

    if (systemAmount > 0) {
      operations.push(this.recordOrderBalanceTransaction(
        { paymentId: payment._id, ownerType: 'system', reason: 'order_system_share' },
        {
          ownerType: 'system',
          orderId: order._id,
          paymentId: payment._id,
          amount: systemAmount,
          type: 'credit',
          reason: 'order_system_share',
          note: distributionVersion >= 2
            ? 'Category flat fees + 15% delivery fee, excluding DigiKuntz platform fees'
            : 'packaging fees + 25% delivery fee, excluding DigiKuntz platform fees',
          currency,
        },
      ));
    }

    if (restaurantAmount > 0 && order.restaurantId) {
      operations.push(this.recordOrderBalanceTransaction(
        { paymentId: payment._id, ownerType: 'restaurant', restaurantId: order.restaurantId, reason: 'order_restaurant_share' },
        {
          ownerType: 'restaurant',
          restaurantId: order.restaurantId,
          orderId: order._id,
          paymentId: payment._id,
          amount: restaurantAmount,
          type: 'credit',
          reason: 'order_restaurant_share',
          note: distributionVersion >= 2
            ? 'Items + packaging - promotion - category flat fees'
            : 'Payment amount minus delivery and packaging fees',
          currency,
        },
      ));
    }

    if (driverAmount > 0 && driverId) {
      operations.push(this.recordOrderBalanceTransaction(
        { paymentId: payment._id, ownerType: 'user', userId: driverId, reason: 'order_delivery_share' },
        {
          ownerType: 'user',
          userId: driverId,
          orderId: order._id,
          paymentId: payment._id,
          amount: driverAmount,
          type: 'credit',
          reason: 'order_delivery_share',
          note: distributionVersion >= 2 ? '85% delivery fee' : '75% delivery fee',
          currency,
        },
      ));
    }

    await Promise.all(operations);
  }

  private displayName(user: any) {
    return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || user?.phone || '';
  }

  private orderAddress(order: any) {
    const address = order.deliveryAddress || {};
    return [address.district, address.city, address.details].filter(Boolean).join(', ');
  }

  private async notifyRestaurantStaffOrderConfirmed(order: any) {
    try {
      const [client, restaurant, staff] = await Promise.all([
        this.userModel.findById(order.userId).select('firstName lastName email phone'),
        this.restaurantModel.findById(order.restaurantId).select('name managerId'),
        this.userModel.find({
          $or: [
            {
              restaurantId: order.restaurantId,
              role: { $in: [UserRole.MANAGER, UserRole.EMPLOYEE] },
            },
          ],
          isActive: { $ne: false },
        }).select('email phone'),
      ]);

      if (restaurant?.managerId) {
        const manager = await this.userModel
          .findOne({ _id: restaurant.managerId, isActive: { $ne: false } })
          .select('email phone');
        if (manager && !staff.some((member) => String(member._id) === String(manager._id))) {
          staff.push(manager);
        }
      }

      await this.notifications.sendRestaurantOrderConfirmed(
        staff.map((user) => ({ email: user.email, phone: user.phone })),
        {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          restaurantName: restaurant?.name,
          clientName: this.displayName(client),
          clientPhone: client?.phone,
          address: this.orderAddress(order),
          total: Number(order.pricingSnapshot?.grandTotal || 0),
          items: (order.items || []).map((item: any) => ({
            name: item.name,
            quantity: Number(item.quantity || 0),
            subtotal: Number(item.subtotal || 0),
          })),
        },
      );
    } catch (error: any) {
      this.logger.warn(`Unable to notify restaurant staff for order ${order._id}: ${error?.message || error}`);
    }
  }

  async ensurePaidOrderBalances(orderOrId: any, driverId?: any) {
    const order = typeof orderOrId === 'string' || isValidObjectId(orderOrId)
      ? await this.orderModel.findById(orderOrId)
      : orderOrId;
    if (!order) throw new NotFoundException('Order not found');
    if (order.paymentStatus !== PaymentStatus.PAID) {
      throw new BadRequestException('Order payment is not paid');
    }

    const payment = await this.paymentModel
      .findOne({ orderId: order._id, status: PaymentStatus.PAID })
      .sort({ completedAt: -1, updatedAt: -1 });
    if (!payment) throw new NotFoundException('Paid payment not found for order');

    await this.creditOrderBalances(order, payment, driverId);
    return { ok: true };
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
    if (success && !order.paymentConfirmedAt) order.paymentConfirmedAt = new Date();
    await order.save();

    if (success && !wasAlreadyPaid) {
      // Stock déjà décrémenté dans la transaction de création de commande
      // (cf. OrdersService.placeOrderWithinSession). On ne re-décrémente pas ici.
      await this.creditOrderBalances(order, payment);
      const user = await this.userModel.findById(order.userId);
      if (user) await this.notifications.sendOrderConfirmed(user.email, user.phone, order.orderNumber);
      await this.notifyRestaurantStaffOrderConfirmed(order);
    }

    if (failed && !wasAlreadyFailed && !wasAlreadyPaid) {
      // Restitution du stock réservé à la création de la commande
      await this.restoreReservedStockIfCurrentCameroonDay(order, 'payment_failed');
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePaidOrderBalances() {
    if (!(await this.cronLease.acquire('payments.reconcile', 50 * 1000))) return;
    const limit = Number(process.env.BALANCE_RECONCILIATION_BATCH_LIMIT || 100);
    const payments = await this.paymentModel
      .find({ status: PaymentStatus.PAID })
      .sort({ updatedAt: -1 })
      .limit(Number.isFinite(limit) && limit > 0 ? limit : 100);

    for (const payment of payments) {
      try {
        const order = await this.orderModel.findById(payment.orderId);
        if (!order || order.paymentStatus !== PaymentStatus.PAID) continue;
        const driverId = order.orderStatus === OrderStatus.DELIVERED ? order.assignedDriverId : undefined;
        await this.creditOrderBalances(order, payment, driverId);
      } catch (err: any) {
        this.logger.warn(`Failed to reconcile balances for payment ${payment._id}: ${err?.message || err}`);
      }
    }
  }

}
