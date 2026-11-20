import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, isValidObjectId, Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { timingSafeEqual } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Payment, PaymentDocument, PAYMENT_METHOD_DIRECT_CHARGE } from '../../database/schemas/payment.schema';
import { Balance, BalanceDocument, BalanceAccountType } from '../../database/schemas/balance.schema';
import { BalanceTransaction, BalanceTransactionDocument } from '../../database/schemas/balance-transaction.schema';
import { WithdrawalRequest, WithdrawalRequestDocument } from '../../database/schemas/withdrawal-request.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { DigikuntzProvider, DirectChargeResult } from './providers/digikuntz.provider';
import { DigikuntzDirectChargeError, directChargeCodeForProviderError, directChargeException } from './errors/direct-charge.errors';
import { DirectChargeInitiateResponseDto } from './dto/payment-response.dto';
import { InitiateDirectChargeDto } from './dto/initiate-direct-charge.dto';
import { DirectChargeOperator, detectMobileMoneyOperator, normalizeCmPhoneForDirectCharge } from './utils/mobile-money.util';
import { isAllowedPaymentLink } from './utils/payment-link.util';
import { getConfirmationUssd } from './config/mobile-money-ussd';
import { ClientPaymentView, toClientPaymentView } from './utils/client-payment-view.util';
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
import { normalizeDigikuntzStatus } from '../../common/utils/digikuntz-status.util';
import {
  isDistributionBalanced,
  orderBalanceDistribution,
  orderPaymentAmount,
} from './utils/order-balance-distribution.util';

/** Fenêtre pendant laquelle un appel direct `calling` est considéré comme encore en cours. */
const DIRECT_CHARGE_IN_PROGRESS_MS = 60 * 1000;

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private isSyncingProviderPayments = false;
  /** Throttle du rafraîchissement provider déclenché par le polling client. */
  private readonly statusSyncCache = new Map<string, number>();
  private readonly statusSyncIntervalMs =
    Math.max(1, Number(process.env.PAYMENT_STATUS_SYNC_SECONDS || 10)) * 1000;

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
    private auditLogs: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async onModuleInit() {
    await this.ensureBalanceTransactionIndexes();
    await this.ensureOpenPaymentIndex();
    await this.normalizeBalanceTransactionIds();
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

  /**
   * Nettoie les données existantes de BalanceTransaction :
   *   1. Convertit les restaurantId/userId stockés en string vers ObjectId
   *   2. Supprime les doublons de transactions delivery (même paymentId+userId+reason)
   *      en gardant celle avec un ObjectId (ou la plus récente en dernier recours).
   *
   * Ces incohérences viennent de l'ancienne version de recordOrderBalanceTransaction
   * qui ne normalisait pas les types BSON, permettant à l'index unique partiel de
   * ne pas détecter les doublons.
   */
  private async normalizeBalanceTransactionIds() {
    try {
      const orderReasons = ['order_restaurant_share', 'order_delivery_share', 'order_system_share'];

      // 1. Supprimer les doublons string → certains paiements ont déjà DEUX documents
      //    (un avec string ID, un avec ObjectId). On garde l'ObjectId et on supprime
      //    le string pour libérer la contrainte unique avant la conversion.
      //    Regex: paymentId + ownerType + (restaurantId ou userId) + reason.
      for (const idField of ['restaurantId', 'userId']) {
        const dupGroups = await this.transactionModel.aggregate([
          {
            $match: {
              reason: { $in: orderReasons },
              paymentId: { $type: 'objectId' },
              [idField]: { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: { paymentId: '$paymentId', ownerType: '$ownerType', reason: '$reason' },
              ids: { $push: '$_id' },
              idTypes: { $push: { $type: `$${idField}` } },
              count: { $sum: 1 },
            },
          },
          { $match: { count: { $gt: 1 } } },
        ]);

        let removed = 0;
        for (const group of dupGroups) {
          const toDelete: any[] = [];
          for (let i = 0; i < group.ids.length; i++) {
            if (group.idTypes[i] === 'string') toDelete.push(group.ids[i]);
          }
          if (toDelete.length > 0) {
            const del = await this.transactionModel.deleteMany({ _id: { $in: toDelete } });
            removed += del.deletedCount;
          }
        }
        if (removed > 0) {
          this.logger.log(`Migration: removed ${removed} duplicate transaction(s) with string ${idField}`);
        }
      }

      // 2. Convertir les restaurantId string → ObjectId (pour les éventuels isolés)
      const fixedRestaurants = await this.transactionModel.updateMany(
        { restaurantId: { $type: 'string' }, reason: { $in: orderReasons } },
        [{ $set: { restaurantId: { $toObjectId: '$restaurantId' } } }],
      );

      // 3. Convertir les userId string → ObjectId
      const fixedUsers = await this.transactionModel.updateMany(
        { userId: { $type: 'string' }, reason: { $in: orderReasons } },
        [{ $set: { userId: { $toObjectId: '$userId' } } }],
      );

      if (fixedRestaurants.modifiedCount > 0 || fixedUsers.modifiedCount > 0) {
        this.logger.log(
          `Migration: converted ${fixedRestaurants.modifiedCount} restaurantId(s)`
          + ` and ${fixedUsers.modifiedCount} userId(s) from string to ObjectId`,
        );
      }
    } catch (error: any) {
      this.logger.warn(`Balance transaction ID migration skipped: ${error?.message || error}`);
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
    this.assertPaymentWindow(order);

    const existingPayment = await this.paymentModel
      .findOne({ orderId: order._id, status: PaymentStatus.PROCESSING })
      .sort({ createdAt: -1 });

    if (existingPayment) {
      const reused = await this.reuseProcessingPayment(existingPayment, order);
      if (reused) return reused;
    }

    const user = await this.userModel.findById(order.userId);
    const paymentAmount = orderPaymentAmount(order);
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
        { idempotencyKey: `payin-${payment._id}` },
      );

      payment.providerRef = response.providerRef;
      payment.transactionRef = response.transactionRef;
      payment.paymentLink = response.paymentLink;
      payment.paymentWithTaxes = response.paymentWithTaxes;
      payment.invoiceTaxes = response.invoiceTaxes;
      await payment.save();

      order.paymentStatus = PaymentStatus.PROCESSING;
      await order.save();

      this.auditLogs.record({
        actorId: actor.sub,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'payment.initiate',
        resourceType: 'payment',
        resourceId: String(payment._id),
        metadata: {
          amount: paymentAmount,
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          provider: 'digikuntz',
        },
        method: 'POST',
        path: `/payments/initiate/${orderId}`,
        statusCode: 200,
      });

      return { payment, checkout: response };
    } catch (error: any) {
      // Gateway DigiKuntz indisponible : issue inconnue (la demande a peut-être été reçue).
      // Le Payment n'est JAMAIS supprimé ; il est marqué unknown et le client doit vérifier avant toute relance.
      if (error instanceof ServiceUnavailableException) {
        await this.markPaymentOutcomeUnknown(payment, 'hosted_provider_outcome_unknown');
        this.logger.warn(`Hosted payment outcome unknown for payment ${payment._id} (order ${order._id})`);
        throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');
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

  /** Réservé au client propriétaire de la commande (le staff garde le paiement hébergé). */
  private assertDirectChargeOwner(order: OrderDocument | any, actor: any) {
    if (actor?.role === UserRole.CLIENT && this.refId(order.userId) === String(actor.sub)) return;
    throw new ForbiddenException('Seul le client propriétaire de la commande peut lancer ce paiement.');
  }

  /** Téléphone lu côté serveur uniquement. Toute validation échoue AVANT la création du Payment. */
  private resolveDirectChargePhone(
    user: any,
    overridePhone?: string,
    requestedOperator?: DirectChargeOperator,
  ): { phone: string; operator: DirectChargeOperator } {
    // Le numéro du profil reste le défaut ; le client peut le corriger dans
    // le récap. Le backend revalide le format et la cohérence du réseau.
    const raw = String(overridePhone || user?.phone || '').trim();
    if (!raw) throw directChargeException('PAYMENT_PHONE_MISSING');
    const phone = normalizeCmPhoneForDirectCharge(raw);
    if (!phone) throw directChargeException('PAYMENT_PHONE_INVALID');
    const operator = detectMobileMoneyOperator(phone);
    if (!operator) throw directChargeException('PAYMENT_OPERATOR_UNSUPPORTED');
    if (requestedOperator && requestedOperator !== operator) {
      throw directChargeException('PAYMENT_OPERATOR_MISMATCH');
    }
    return { phone, operator };
  }

  private directChargeOperatorOrNull(value: unknown): DirectChargeOperator | null {
    return value === 'ORANGEMONEY' || value === 'MTN' ? value : null;
  }

  /** L'opérateur renvoyé par DigiKuntz fait foi ; une divergence avec la table locale est journalisée (sans téléphone). */
  private resolveProviderOperator(
    providerOperator: unknown,
    localOperator: DirectChargeOperator,
    paymentId: any,
  ): DirectChargeOperator {
    const fromProvider = this.directChargeOperatorOrNull(providerOperator);
    if (!fromProvider) return localOperator;
    if (fromProvider !== localOperator) {
      this.logger.warn(
        `Direct charge operator mismatch for payment ${paymentId}: local=${localOperator} provider=${fromProvider}`,
      );
    }
    return fromProvider;
  }

  private buildDirectChargeResponse(
    payment: any,
    order: any,
    outcome: 'prompt_sent' | 'refused',
    operator: DirectChargeOperator,
  ): DirectChargeInitiateResponseDto {
    const refused = outcome === 'refused';
    return {
      paymentId: String(payment._id),
      orderId: String(order._id),
      amount: Number(payment.amount),
      currency: 'XAF',
      status: payment.status,
      operator,
      outcome,
      fallback: refused,
      paymentLink: refused && isAllowedPaymentLink(payment.paymentLink) ? payment.paymentLink : null,
      ussdCode: getConfirmationUssd(operator),
    };
  }

  /** Issue inconnue : le Payment reste PROCESSING et n'est jamais supprimé ni libéré automatiquement. */
  private async markPaymentOutcomeUnknown(payment: any, reason: string) {
    try {
      await this.paymentModel.updateOne(
        { _id: payment._id, status: PaymentStatus.PROCESSING },
        { $set: { directChargeOutcome: 'unknown', callbackPayload: { reason } } },
      );
    } catch (error: any) {
      this.logger.error(`Unable to mark payment ${payment._id} with unknown outcome: ${error?.message || error}`);
    }
  }

  /** Identifiant de commande au format ObjectId strict (400 sinon, avant toute requête base). */
  private assertValidObjectId(id: string) {
    if (!isValidObjectId(id) || !/^[a-fA-F0-9]{24}$/.test(String(id))) {
      throw new BadRequestException('Identifiant de commande invalide.');
    }
  }

  /** Commandes payables en direct : en attente de paiement, ou échec de paiement (relance avec stock revérifié). */
  /**
   * Une commande ne reste payable que pendant la fenêtre de paiement
   * (ORDER_PAYMENT_TIMEOUT_MINUTES, 30 min par défaut). Au-delà, le cron l'a
   * expirée et une nouvelle commande est nécessaire.
   */
  private assertPaymentWindow(order: any) {
    const createdAt = new Date(order?.createdAt || 0).getTime();
    if (
      !Number.isFinite(createdAt) ||
      createdAt <= 0 ||
      Date.now() - createdAt > this.getOrderPaymentTimeoutMs()
    ) {
      throw directChargeException('PAYMENT_EXPIRED');
    }
  }

  private assertDirectChargeOrderStatus(order: any) {
    if (order.orderStatus === OrderStatus.PENDING_PAYMENT || order.orderStatus === OrderStatus.PAYMENT_FAILED) return;
    throw new BadRequestException('Cette commande ne peut plus être payée.');
  }

  /**
   * Une issue `unknown` n'est jamais libérée (vérification manuelle requise). Un appel `calling`
   * récent (< 60 s) est en cours ; au-delà il devient `unknown`. Ne renvoie que si l'issue est résolue.
   */
  private async assertPaymentOutcomeResolvable(payment: any) {
    const outcome = payment.directChargeOutcome;
    if (outcome === 'unknown') throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');
    if (outcome !== 'calling') return;
    const startedAt = new Date(payment.initiatedAt || payment.createdAt || 0).getTime();
    if (startedAt && Date.now() - startedAt < DIRECT_CHARGE_IN_PROGRESS_MS) {
      throw directChargeException('PAYMENT_IN_PROGRESS');
    }
    await this.markPaymentOutcomeUnknown(payment, 'direct_charge_stale_calling');
    throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');
  }

  /**
   * Réutilisation idempotente d'un Payment PROCESSING de la commande (D9).
   * Renvoie la réponse à rejouer (demande en attente, lien de secours), ou `null` UNIQUEMENT quand
   * DigiKuntz confirme un échec (payin_error / payin_closed) : l'appelant crée alors une nouvelle tentative.
   * Toute autre issue (statut inconnu, vérification impossible) lève PAYMENT_OUTCOME_UNKNOWN : jamais de nouvelle demande.
   */
  private async reuseDirectPayment(
    payment: any,
    order: any,
    retryContext?: {
      user: any;
      phone: string;
      operator: DirectChargeOperator;
      actor: any;
    },
  ): Promise<DirectChargeInitiateResponseDto | null> {
    if (payment.paymentMethod !== PAYMENT_METHOD_DIRECT_CHARGE) {
      throw directChargeException('PAYMENT_IN_PROGRESS', 'Un autre paiement est déjà en cours pour cette commande.');
    }

    const outcome: string | undefined = payment.directChargeOutcome;
    // Timeout sans référence : le même Payment + la même clé d'idempotence
    // peuvent être rejoués sans risque de double débit, après un cooldown.
    if (outcome === 'unknown' && !payment.providerRef && !payment.paymentLink) {
      return this.retryUnknownDirectCharge(payment, order, retryContext);
    }
    if (outcome && !['calling', 'prompt_sent', 'refused'].includes(outcome)) {
      throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');
    }
    await this.assertPaymentOutcomeResolvable(payment);
    if (!outcome && !payment.providerRef) {
      // Ancien paiement direct sans référence : on ne sait rien, on ne relance pas et on ne libère pas.
      throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');
    }

    if (payment.providerRef) {
      let remote: { id: string; status: string; data: any };
      try {
        remote = await this.provider.getTransactionStatusOrThrow(payment.providerRef);
      } catch {
        // Statut non vérifiable depuis le chemin client : issue inconnue, jamais une nouvelle demande.
        throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');
      }

      if (remote.status === 'payin_success') {
        await this.applyPayinStatus(payment, order, remote.status, remote);
        throw new BadRequestException('Order already paid');
      }
      if (remote.status === 'payin_error' || remote.status === 'payin_closed') {
        // Seul échec confirmé par DigiKuntz : la commande peut recevoir une nouvelle tentative.
        await this.applyPayinStatus(payment, order, remote.status, remote);
        return null;
      }
      if (remote.status !== 'payin_pending') {
        throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');
      }
    }

    const operator = this.directChargeOperatorOrNull(payment.directChargeOperator);
    if (!operator) throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');

    return this.buildDirectChargeResponse(payment, order, outcome === 'refused' ? 'refused' : 'prompt_sent', operator);
  }

  /**
   * Rejoue la même demande directe (même Payment, même clé d'idempotence)
   * après un timeout. Sûr par construction : le provider applique « at most
   * once per user per route » sur cette clé ; un 2e débit est impossible.
   */
  private async retryUnknownDirectCharge(
    payment: any,
    order: any,
    ctx?: { user: any; phone: string; operator: DirectChargeOperator; actor: any },
  ): Promise<DirectChargeInitiateResponseDto> {
    if (!ctx) throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');

    const updatedAt = new Date(payment.updatedAt || payment.initiatedAt || 0).getTime();
    const cooldownMs =
      Math.max(1, Number(process.env.PAYMENT_UNKNOWN_RETRY_COOLDOWN_SECONDS || 60)) * 1000;
    if (updatedAt && Date.now() - updatedAt < cooldownMs) {
      throw directChargeException(
        'PAYMENT_OUTCOME_UNKNOWN',
        'La demande précédente est encore en cours de vérification. Patientez un instant avant de réessayer.',
      );
    }

    const claimed = await this.paymentModel.findOneAndUpdate(
      {
        _id: payment._id,
        status: PaymentStatus.PROCESSING,
        directChargeOutcome: 'unknown',
      },
      {
        $set: {
          directChargeOutcome: 'calling',
          callbackPayload: { reason: 'direct_charge_retry' },
        },
      },
      { new: true },
    );
    if (!claimed) throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');

    // On rejoue strictement la même requête : même numéro, même réseau.
    const phone = String(payment.directChargePhone || ctx.phone);
    const operator =
      this.directChargeOperatorOrNull(payment.directChargeOperator) || ctx.operator;

    return this.executeDirectCharge(claimed, order, ctx.user, {
      phone,
      operator,
      actor: ctx.actor,
    });
  }

  /**
   * Relance sur une commande PAYMENT_FAILED : le stock est réservé de nouveau, dans la MÊME transaction
   * que la transition PAYMENT_FAILED → PENDING_PAYMENT et que la création du Payment « calling ».
   * Un échec quelconque annule l'ensemble (aucun décrément orphelin, aucun Payment sans stock).
   * Une commande PENDING_PAYMENT garde le comportement d'origine (stock déjà réservé).
   */
  private async openDirectAttempt(order: any, attempt: Record<string, unknown>): Promise<PaymentDocument> {
    if (order.orderStatus !== OrderStatus.PAYMENT_FAILED) {
      const [payment] = await this.paymentModel.create([attempt]);
      return payment;
    }

    const session = await this.connection.startSession();
    try {
      let payment: PaymentDocument | undefined;
      await session.withTransaction(async () => {
        await this.reserveStockForRetry(order, session);
        [payment] = await this.paymentModel.create([attempt], { session });
      });
      return payment as PaymentDocument;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Décrémente le stock de chaque article (`adjustStock` conditionnel, atomique par document) puis
   * transitionne la commande PAYMENT_FAILED → PENDING_PAYMENT par une écriture conditionnelle.
   * Un seul appel gagne la transition ; les autres abandonnent et leur transaction est annulée.
   */
  private async reserveStockForRetry(order: any, session: ClientSession) {
    for (const item of order.items || []) {
      const quantity = Number(item.quantity) || 0;
      try {
        await this.inventory.adjustStock(item.menuItemId, -quantity, session);
      } catch (error: any) {
        if (!/Insufficient stock/i.test(String(error?.message || ''))) throw error;
        throw directChargeException(
          'INSUFFICIENT_STOCK',
          `« ${item.name} » n'est plus disponible dans la quantité demandée.`,
          {
            items: [{
              menuItemId: String(item.menuItemId),
              name: item.name,
              requested: quantity,
              available: 0,
              reason: 'insufficient',
            }],
          },
        );
      }
    }

    const transitioned = await this.orderModel.findOneAndUpdate(
      { _id: order._id, orderStatus: OrderStatus.PAYMENT_FAILED, paymentStatus: { $ne: PaymentStatus.PAID } },
      { $set: { orderStatus: OrderStatus.PENDING_PAYMENT, paymentStatus: PaymentStatus.PENDING } },
      { new: true, session },
    );
    if (!transitioned) throw directChargeException('PAYMENT_IN_PROGRESS');
    order.orderStatus = transitioned.orderStatus;
    order.paymentStatus = transitioned.paymentStatus;
  }

  /**
   * Initiation du paiement mobile money direct (DigiKuntz Direct Charge).
   * Ordre : contrôle d'accès → réutilisation → téléphone/opérateur → Payment `calling` → appel provider
   * → issue (prompt_sent | refused | rejected | unknown). Aucune suppression de Payment.
   */
  async initiateDirectPayment(
    orderId: string,
    actor: any,
    dto: InitiateDirectChargeDto = {},
  ): Promise<DirectChargeInitiateResponseDto> {
    this.assertValidObjectId(orderId);
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    this.assertDirectChargeOwner(order, actor);
    if (order.paymentStatus === PaymentStatus.PAID) throw new BadRequestException('Order already paid');
    if (!this.isOrderFromCurrentCameroonDay(order)) {
      throw new BadRequestException('Le paiement est autorisé uniquement pour les commandes du jour.');
    }
    this.assertPaymentWindow(order);
    this.assertDirectChargeOrderStatus(order);

    const user = await this.userModel.findById(order.userId);
    const { phone, operator } = this.resolveDirectChargePhone(
      user,
      dto.phone,
      dto.paymentMethodCode,
    );

    const paymentAmount = orderPaymentAmount(order);
    if (paymentAmount <= 0) throw new BadRequestException('Invalid order payment amount');

    const existingPayment = await this.paymentModel
      .findOne({ orderId: order._id, status: PaymentStatus.PROCESSING })
      .sort({ createdAt: -1 });
    if (existingPayment) {
      const reused = await this.reuseDirectPayment(existingPayment, order, {
        user,
        phone,
        operator,
        actor,
      });
      if (reused) return reused;
    }

    let payment: PaymentDocument;
    try {
      payment = await this.openDirectAttempt(order, {
        orderId: order._id,
        amount: paymentAmount,
        provider: 'digikuntz',
        currency: 'XAF',
        status: PaymentStatus.PROCESSING,
        paymentMethod: PAYMENT_METHOD_DIRECT_CHARGE,
        directChargeOperator: operator,
        directChargePhone: phone,
        directChargeOutcome: 'calling',
        initiatedAt: new Date(),
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const concurrentPayment = await this.paymentModel
        .findOne({ orderId: order._id, status: PaymentStatus.PROCESSING })
        .sort({ createdAt: -1 });
      const reused = concurrentPayment
        ? await this.reuseDirectPayment(concurrentPayment, order, {
            user,
            phone,
            operator,
            actor,
          })
        : null;
      if (reused) return reused;
      throw directChargeException('PAYMENT_IN_PROGRESS');
    }

    return this.executeDirectCharge(payment, order, user, {
      phone,
      operator,
      actor,
      paymentAmount,
    });
  }

  /**
   * Exécute (ou rejoue avec la même clé d'idempotence) un direct charge sur un
   * Payment existant. Utilisé à la création et pour un retry `unknown`
   * explicitement demandé par le client après le cooldown.
   */
  private async executeDirectCharge(
    payment: PaymentDocument,
    order: OrderDocument,
    user: any,
    ctx: {
      phone: string;
      operator: DirectChargeOperator;
      actor: any;
      paymentAmount?: number;
    },
  ): Promise<DirectChargeInitiateResponseDto> {
    const paymentAmount = ctx.paymentAmount ?? Number(payment.amount);
    const { phone, operator, actor } = ctx;
    let response: DirectChargeResult;
    try {
      response = await this.provider.initiateDirectCharge({
        estimation: paymentAmount,
        userPhone: phone,
        userEmail: user?.email,
        userCountry: 'Cameroon',
        senderName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || order.orderNumber,
        // Le provider route par le numéro ; on ne force pas paymentMethodCode
        // et on n'envoie pas de callbackUrl (format de référence validé).
        paymentMethodCode: operator,
        raisonForTransfer: `Commande ${order.orderNumber}`,
        // Clé stable liée au Payment local : un retry réseau ne crée pas une
        // seconde demande chez DigiKuntz (TTL fournisseur 24 h).
        idempotencyKey: String(payment._id),
      });
    } catch (error: any) {
      if (error instanceof DigikuntzDirectChargeError && error.kind === 'rejected') {
        await this.paymentModel.updateOne(
          { _id: payment._id, status: PaymentStatus.PROCESSING },
          {
            $set: {
              status: PaymentStatus.FAILED,
              completedAt: new Date(),
              directChargeOutcome: 'rejected',
              callbackPayload: {
              reason: 'direct_charge_rejected',
              providerCode: error.providerCode ?? null,
              // Diagnostic serveur uniquement (jamais exposé par la projection client).
              providerMessage: error.providerMessage ?? null,
            },
            },
          },
        );
        this.logger.warn(
          `Direct charge rejected for payment ${payment._id} (order ${order._id}): ${error.providerCode ?? 'no_code'} HTTP ${error.httpStatus ?? 'n/a'}`,
        );
        throw directChargeException(directChargeCodeForProviderError(error.providerCode));
      }

      // Issue inconnue : la demande a peut-être été reçue. Le même Payment et
      // la même clé d'idempotence pourront être rejoués après un cooldown.
      await this.markPaymentOutcomeUnknown(payment, 'direct_charge_outcome_unknown');
      this.logger.warn(`Direct charge outcome unknown for payment ${payment._id} (order ${order._id})`);
      this.auditLogs.record({
        actorId: actor.sub,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'payment.initiate_direct_unknown',
        resourceType: 'payment',
        resourceId: String(payment._id),
        metadata: { orderId: String(order._id), orderNumber: order.orderNumber, operator, outcome: 'unknown', provider: 'digikuntz' },
        method: 'POST',
        path: `/payments/initiate-direct/${order._id}`,
        statusCode: 409,
      });
      throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');
    }

    const refused = response.refused === true;
    if (refused && !isAllowedPaymentLink(response.paymentLink)) {
      await this.paymentModel.updateOne(
        { _id: payment._id, status: PaymentStatus.PROCESSING },
        {
          $set: {
            status: PaymentStatus.FAILED,
            completedAt: new Date(),
            directChargeOutcome: 'rejected',
            providerRef: response.providerRef,
            transactionRef: response.transactionRef,
            callbackPayload: { reason: 'direct_charge_refused_without_valid_link' },
          },
        },
      );
      this.logger.warn(`Direct charge refused without a valid payment link for payment ${payment._id}`);
      throw directChargeException('PAYMENT_REJECTED');
    }

    const outcome: 'prompt_sent' | 'refused' = refused ? 'refused' : 'prompt_sent';
    const resolvedOperator = this.resolveProviderOperator(response.paymentMethodCode, operator, payment._id);

    try {
      payment.providerRef = response.providerRef;
      payment.transactionRef = response.transactionRef;
      payment.paymentWithTaxes = response.paymentWithTaxes;
      payment.invoiceTaxes = response.invoiceTaxes;
      payment.directChargeOperator = resolvedOperator;
      payment.directChargeOutcome = outcome;
      if (refused) payment.paymentLink = response.paymentLink;
      await payment.save();

      order.paymentStatus = PaymentStatus.PROCESSING;
      await order.save();
    } catch (error: any) {
      // DigiKuntz a accepté la demande mais la persistance locale échoue : issue inconnue, rien ne doit être supprimé.
      this.logger.error(
        `Direct charge accepted but local persistence failed (payment ${payment._id}, providerRef ${response.providerRef}): ${error?.message || error}`,
      );
      await this.markPaymentOutcomeUnknown(payment, 'direct_charge_persistence_failed');
      throw directChargeException('PAYMENT_OUTCOME_UNKNOWN');
    }

    this.auditLogs.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'payment.initiate_direct',
      resourceType: 'payment',
      resourceId: String(payment._id),
      metadata: {
        amount: paymentAmount,
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        operator: resolvedOperator,
        outcome,
        refusalReason: response.refusalReason ?? null,
        provider: 'digikuntz',
      },
      method: 'POST',
      path: `/payments/initiate-direct/${order._id}`,
      statusCode: 201,
    });

    return this.buildDirectChargeResponse(payment, order, outcome, resolvedOperator);
  }

  private async reuseProcessingPayment(
    initialPayment: PaymentDocument,
    order: OrderDocument,
    waitForInitialization = false,
  ) {
    // Un paiement direct en cours ne doit pas recevoir un lien hébergé par-dessus.
    if (initialPayment.paymentMethod === PAYMENT_METHOD_DIRECT_CHARGE) {
      throw directChargeException(
        'PAYMENT_IN_PROGRESS',
        'Un paiement mobile money direct est déjà en cours pour cette commande. Confirmez-le sur votre téléphone avant de relancer un paiement.',
      );
    }

    // Issue `unknown` (ou appel `calling` périmé) : jamais libérée par le verrou périmé.
    await this.assertPaymentOutcomeResolvable(initialPayment);

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
            directChargeOutcome: { $nin: ['unknown', 'calling'] },
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

  /** Vue client du dernier paiement (projection : pas de callbackPayload, providerRef ni transactionRef). */
  async paymentStatus(orderId: string, actor: any): Promise<ClientPaymentView | null> {
    this.assertValidObjectId(orderId);
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    this.assertOrderAccess(order, actor);
    let payment = await this.paymentModel.findOne({ orderId }).sort({ createdAt: -1 });
    if (!payment) return null;

    // Le webhook n'atteint pas toujours un backend local/mini : on rafraîchit
    // le statut provider à la demande (throttlé) pour que le polling client
    // voie le paiement confirmé sans attendre le cron d'une minute.
    if (
      [PaymentStatus.PENDING, PaymentStatus.PROCESSING].includes(payment.status as PaymentStatus) &&
      payment.providerRef
    ) {
      const cacheKey = String(payment._id);
      const lastSync = this.statusSyncCache.get(cacheKey) || 0;
      if (Date.now() - lastSync >= this.statusSyncIntervalMs) {
        this.statusSyncCache.set(cacheKey, Date.now());
        if (this.statusSyncCache.size > 1000) this.statusSyncCache.clear();
        try {
          const remote = await this.provider.getTransactionStatus(payment.providerRef);
          if (remote) {
            await this.applyPayinStatus(payment, order, remote.status, remote);
            payment = (await this.paymentModel.findById(payment._id)) || payment;
          }
        } catch (error: any) {
          this.logger.warn(
            `On-demand payment sync failed for ${payment._id}: ${error?.message || error}`,
          );
        }
      }
    }

    return toClientPaymentView(payment);
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
    // Le payload peut être préfixé (`transaction_payin_*`) : on normalise avant comparaison.
    const payloadStatus = normalizeDigikuntzStatus(payload.status) || payload.status;
    if (payment.status === PaymentStatus.PAID) return { ok: true, idempotent: true };
    if (payment.status === PaymentStatus.FAILED && ['payin_error', 'payin_closed'].includes(payloadStatus)) {
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

  /**
   * Résolution manuelle d'une issue ambiguë (`unknown` / `calling`) par un administrateur.
   * Réutilise `applyPayinStatus` pour conserver l'atomicité et les effets de bord
   * (crédit restaurant, notification, restitution du stock).
   */
  async resolvePaymentOutcome(id: string, actor: any, outcome: 'paid' | 'failed') {
    if (!['paid', 'failed'].includes(outcome)) {
      throw new BadRequestException('Issue invalide : `paid` ou `failed` attendu.');
    }

    const payment = await this.paymentModel.findOne({
      $or: [{ providerRef: id }, { _id: isValidObjectId(id) ? id : null }],
    });
    if (!payment) throw new NotFoundException(`Paiement ${id} introuvable`);

    if (payment.status === PaymentStatus.PAID) {
      throw new BadRequestException('Le paiement est déjà PAID ; aucune action requise.');
    }
    if (
      payment.status === PaymentStatus.FAILED
      && outcome === 'paid'
      && !payment.providerRef
    ) {
      throw new BadRequestException('Paiement sans référence fournisseur : résolution impossible.');
    }

    const order = await this.orderModel.findById(payment.orderId);
    if (!order) throw new NotFoundException(`Commande ${payment.orderId} introuvable`);

    const resolvedStatus = outcome === 'paid' ? 'payin_success' : 'payin_error';
    const applied = await this.applyPayinStatus(payment, order, resolvedStatus, {
      id: payment.providerRef,
      status: resolvedStatus,
      resolvedManually: true,
    });
    if (!applied) {
      throw new BadRequestException('Cette transition a déjà été appliquée ou n’est pas autorisée pour ce paiement.');
    }

    await this.auditLogs.record({
      actorId: actor?.sub,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action: 'payment.resolve_outcome',
      resourceType: 'payment',
      resourceId: String(payment._id),
      metadata: {
        outcome,
        orderId: String(order._id),
        paymentId: String(payment._id),
        providerRef: payment.providerRef ?? null,
      },
      method: 'POST',
      path: '/payments/:id/resolve',
      statusCode: 200,
    });

    return { ok: true, paymentId: String(payment._id), outcome };
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
    const batchLimit = Number(process.env.PAYMENT_EXPIRY_BATCH_LIMIT || 200);
    const safeBatchLimit = Number.isFinite(batchLimit) && batchLimit > 0 ? batchLimit : 200;
    // `.slice()` plutôt que `.limit()` : la requête reste lisible et bornée, et
    // le tableau n'est jamais `undefined` si le driver change.
    const staleOrders = (
      await this.orderModel.find({
        orderStatus: OrderStatus.PENDING_PAYMENT,
        createdAt: { $lt: cutoff },
      })
    ).slice(0, safeBatchLimit);

    let heldByDirectCharge = 0;
    let heldByHostedFallback = 0;
    for (const order of staleOrders) {
      try {
        const latestPayment = await this.paymentModel
          .findOne({ orderId: order._id })
          .sort({ createdAt: -1 });

        // Paiement direct en attente (demande envoyée, appel en cours, issue inconnue) : jamais expiré
        // automatiquement. La synchronisation résout la demande en payin_success / payin_error / payin_closed.
        if (this.isHeldByDirectCharge(latestPayment)) {
          heldByDirectCharge += 1;
          continue;
        }

        if (latestPayment?.providerRef) {
          const remote = await this.provider.getTransactionStatus(latestPayment.providerRef);
          if (!remote) {
            // Fail-closed : provider indisponible → ne JAMAIS expirer la commande.
            // Une panne DigiKuntz ne doit pas annuler une commande dont le
            // paiement a peut-être abouti ; le prochain run tranchera.
            this.logger.warn(
              `Unable to read DigiKuntz status for payment ${latestPayment._id}; order ${order._id} left open`,
            );
            continue;
          }
          if (remote.status !== 'payin_pending') {
            // Issue connue par le provider — laisser applyPayinStatus gérer
            // (succès tardif OU échec déjà confirmé, qui restituera le stock).
            await this.applyPayinStatus(latestPayment, order, remote.status, remote);
            continue;
          }

          // Refus direct suivi d'un lien hébergé : DigiKuntz laisse la
          // transaction en `payin_pending`, le client peut encore payer.
          // On ne libère donc pas le stock pendant la fenêtre de secours.
          if (this.isHostedFallbackStillOpen(latestPayment)) {
            heldByHostedFallback += 1;
            continue;
          }
        }

        await this.expireOrderForTimeout(order, latestPayment);
      } catch (err: any) {
        this.logger.error(`Failed to expire stale order ${order._id}: ${err?.message || err}`);
      }
    }

    if (heldByDirectCharge > 0) {
      this.logger.debug(`${heldByDirectCharge} commande(s) conservée(s) : paiement direct en attente ou issue inconnue`);
    }
    if (heldByHostedFallback > 0) {
      this.logger.debug(`${heldByHostedFallback} commande(s) conservée(s) : lien hébergé de secours encore actif`);
    }
  }

  private isHeldByDirectCharge(payment: any): boolean {
    if (!payment || payment.status !== PaymentStatus.PROCESSING) return false;
    const outcome = payment.directChargeOutcome;

    if (outcome === 'calling') {
      return this.withinDirectChargeHold(payment, this.getCallingHoldMs());
    }
    if (outcome === 'unknown') {
      return this.withinDirectChargeHold(payment, this.getUnknownHoldMs());
    }
    if (
      payment.paymentMethod === PAYMENT_METHOD_DIRECT_CHARGE &&
      outcome === 'prompt_sent'
    ) {
      return this.withinDirectChargeHold(payment, this.getOrderPaymentTimeoutMs());
    }
    return false;
  }

  private withinDirectChargeHold(payment: any, holdMs: number): boolean {
    const startedAt = new Date(payment?.createdAt || payment?.initiatedAt || 0).getTime();
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    return Date.now() - startedAt < holdMs;
  }

  private getCallingHoldMs(): number {
    const minutes = Number(process.env.PAYMENT_DIRECT_CALLING_HOLD_MINUTES || 2);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 2) * 60 * 1000;
  }

  private getUnknownHoldMs(): number {
    const minutes = Number(process.env.PAYMENT_UNKNOWN_HOLD_MINUTES || 30);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
  }

  private getHostedFallbackTimeoutMs(): number {
    const minutes = Number(process.env.PAYMENT_HOSTED_FALLBACK_TIMEOUT_MINUTES);
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
    return safeMinutes * 60 * 1000;
  }

  /**
   * Un direct charge refusé n'est pas une transaction échouée : DigiKuntz laisse
   * la transaction en `payin_pending` et fournit un lien hébergé que le client
   * peut encore régler. Tant que le provider confirme `payin_pending`, on garde
   * la commande (et son stock) ouverte pendant une fenêtre dédiée, plus longue
   * que le TTL standard. Passé ce délai, l'expiration normale reprend.
   */
  private isHostedFallbackStillOpen(payment: any): boolean {
    if (!payment) return false;
    if (payment.status !== PaymentStatus.PROCESSING) return false;
    if (payment.paymentMethod !== PAYMENT_METHOD_DIRECT_CHARGE) return false;
    if (payment.directChargeOutcome !== 'refused') return false;
    if (!isAllowedPaymentLink(payment.paymentLink)) return false;

    const createdAt = payment.createdAt ? new Date(payment.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdAt)) return false;
    return Date.now() - createdAt < this.getHostedFallbackTimeoutMs();
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
      `Order ${transitioned.orderNumber} expired (PENDING_PAYMENT > ${Math.round(this.getOrderPaymentTimeoutMs() / 60000)}min)`,
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

  private async setBalanceTotal(payload: any, session?: ClientSession): Promise<number> {
    const account = this.balanceAccountFromTransactionPayload(payload);
    // Le ledger BalanceTransaction est l'unique source de vérité :
    // retrait initié => débit withdrawal_request ; retrait échoué => refund.
    // Une réconciliation paiement ne doit jamais recréditer un retrait pending.
    const balance = await this.computeAuthoritativeBalance(payload, session);
    const update = await this.balanceModel.updateOne(
      account,
      {
        $set: {
          ...account,
          balance,
          currency: payload.currency || 'XAF',
        },
      },
      { session },
    );

    // Évite l'upsert concurrent sur l'index unique {accountType, ownerId}.
    if (!update.matchedCount) {
      try {
        await this.balanceModel.create(
          [{ ...account, balance, currency: payload.currency || 'XAF' }],
          { session },
        );
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
        await this.balanceModel.updateOne(
          account,
          { $set: { balance, currency: payload.currency || 'XAF' } },
          { session },
        );
      }
    }
    return balance;
  }

  private async computeAuthoritativeBalance(payload: any, session?: ClientSession): Promise<number> {
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
    ]).session(session || null);

    return this.balanceInteger(Number(btRow?.total || 0));
  }

  private async recordOrderBalanceTransaction(filter: any, payload: any, session?: ClientSession) {
    const amount = this.money(payload.amount);
    const doc = {
      ...payload,
      amount,
      currency: payload.currency || 'XAF',
    };

    // Normaliser les IDs en ObjectId pour éviter les doublons liés au type
    // (string vs ObjectId). L'index unique paymentId+ownerType+userId+reason
    // ne peut pas dédoublonner si les valeurs ont des types BSON différents.
    if (doc.orderId) doc.orderId = new Types.ObjectId(String(doc.orderId));
    if (doc.restaurantId) doc.restaurantId = new Types.ObjectId(String(doc.restaurantId));
    if (doc.userId) doc.userId = new Types.ObjectId(String(doc.userId));
    if (filter.orderId) filter.orderId = new Types.ObjectId(String(filter.orderId));
    if (filter.restaurantId) filter.restaurantId = new Types.ObjectId(String(filter.restaurantId));
    if (filter.userId) filter.userId = new Types.ObjectId(String(filter.userId));

    let inserted = false;
    try {
      const result = await this.transactionModel.updateOne(
        filter,
        { $setOnInsert: { ...doc, createdAt: new Date() } },
        { upsert: true, session },
      );
      inserted = Number(result.upsertedCount || 0) > 0;
    } catch (error: any) {
      // Course concurrente sur la même clé d'idempotence : la part est déjà
      // écrite par l'autre appelant, on se contente de recalculer le solde.
      if (error?.code !== 11000) throw error;
    }

    await this.setBalanceTotal(doc, session);
    return inserted;
  }

  private async creditOrderBalances(order: any, payment: any, driverId?: any): Promise<number> {
    if (!payment?._id || !order?._id) return 0;

    // Anomalie déjà constatée : la commande est exclue des crons de reprise
    // jusqu'à correction manuelle (évite une boucle de logs/scan).
    if (order.settlementError) return 0;

    const orderId = new Types.ObjectId(String(order._id));
    const { systemAmount, restaurantAmount, driverAmount, distributionVersion } = orderBalanceDistribution(order);
    const distribution = { systemAmount, restaurantAmount, driverAmount, distributionVersion };

    // L'idempotence est par COMMANDE, pas par tentative de paiement. Des
    // commandes historiques peuvent avoir plusieurs Payment PAID : la
    // présence d'une ligne pour la commande doit suffire à ne pas recréditer.
    const existing = await this.transactionModel
      .find({
        orderId,
        reason: {
          $in: [
            'order_system_share',
            'order_restaurant_share',
            'order_delivery_share',
          ],
        },
      })
      .select('reason userId')
      .lean();

    const hasSystem = existing.some((row: any) => row.reason === 'order_system_share');
    const hasRestaurant = existing.some((row: any) => row.reason === 'order_restaurant_share');
    const driverShare = existing.find((row: any) => row.reason === 'order_delivery_share');
    const hasDriver = Boolean(driverShare);

    if (hasDriver && driverId && String(driverShare.userId) !== String(driverId)) {
      this.logger.warn(
        `Delivery share already credited to another driver for order ${order._id} (kept ${driverShare.userId}, requested ${driverId})`,
      );
    }

    const total = systemAmount + restaurantAmount + driverAmount;
    const collected = orderPaymentAmount(order);
    if (total > collected || (distributionVersion >= 3 && !isDistributionBalanced(order, distribution))) {
      // Ne jamais créditer plus que le montant encaissé. Un snapshot v3
      // incomplet est une anomalie de données : on refuse le crédit et on
      // marque la commande pour qu'elle sorte des crons de reprise.
      this.logger.error(
        `Inconsistent balance distribution for order ${orderId}: parts=${total}, collected=${collected}, version=${distributionVersion}`,
      );
      await this.orderModel.updateOne(
        { _id: orderId, settlementError: null },
        {
          $set: {
            settlementError: 'inconsistent_distribution',
            driverShareSettledAt: new Date(),
          },
        },
      );
      return 0;
    }

    const currency = payment.currency || 'XAF';
    const operations: Array<(session: ClientSession) => Promise<boolean>> = [];

    if (systemAmount > 0 && !hasSystem) {
      operations.push((session) => this.recordOrderBalanceTransaction(
        { paymentId: payment._id, ownerType: 'system', reason: 'order_system_share' },
        {
          ownerType: 'system',
          orderId: order._id,
          paymentId: payment._id,
          amount: systemAmount,
          type: 'credit',
          reason: 'order_system_share',
          note: distributionVersion >= 3
            ? 'Category flat fees + delivery fee share + platform fee'
            : distributionVersion >= 2
              ? 'Category flat fees + 15% delivery fee, excluding DigiKuntz platform fees'
              : 'packaging fees + 25% delivery fee, excluding DigiKuntz platform fees',
          currency,
        },
        session,
      ));
    }

    if (restaurantAmount > 0 && order.restaurantId && !hasRestaurant) {
      operations.push((session) => this.recordOrderBalanceTransaction(
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
        session,
      ));
    }

    if (driverAmount > 0 && driverId && !hasDriver) {
      // Le filtre ne contient volontairement pas `userId` : si la livraison a
      // été réaffectée après un premier crédit, la part existe déjà et
      // `$setOnInsert` ne crée pas une seconde rémunération.
      operations.push((session) => this.recordOrderBalanceTransaction(
        { paymentId: payment._id, ownerType: 'user', reason: 'order_delivery_share' },
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
        session,
      ));
    }

    // Rien à écrire et aucune livraison à marquer (ou déjà marquée) : sortie
    // rapide, sans transaction ni agrégation de solde.
    if (!operations.length && (!driverId || order.driverShareSettledAt)) return 0;

    // Tout ou rien : les trois parts (système, restaurant, livreur) sont
    // écrites dans la même transaction Mongo. Un échec ne laisse jamais un
    // crédit partiel ; le cron de réconciliation reprend l'opération.
    const session = await this.connection.startSession();
    let inserted = 0;
    try {
      await session.withTransaction(async () => {
        // Une nouvelle tentative (write conflict) ne doit pas recompter les
        // insertions de l'essai précédent.
        inserted = 0;
        for (const operation of operations) {
          if (await operation(session)) inserted += 1;
        }

        // Marque la livraison comme réglée (même si driverAmount = 0) pour
        // que le cron ciblé progresse au lieu de rescanner les mêmes ordres.
        if (driverId) {
          await this.orderModel.updateOne(
            { _id: orderId },
            { $set: { driverShareSettledAt: new Date() } },
            { session },
          );
        }
      });
    } finally {
      await session.endSession();
    }

    return inserted;
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

    const payment = await this.resolvePaidPaymentForOrder(order);
    if (!payment) throw new NotFoundException('Paid payment not found for order');

    const inserted = await this.creditOrderBalances(order, payment, driverId);
    return { ok: true, inserted };
  }

  /**
   * Paiement canonique d'une commande payée. `paidPaymentId` est renseigné au
   * moment de la transition PAID ; le fallback couvre les commandes créées
   * avant l'ajout du champ.
   */
  private async resolvePaidPaymentForOrder(order: any) {
    if (order?.paidPaymentId) {
      const canonical = await this.paymentModel.findOne({
        _id: order.paidPaymentId,
        status: PaymentStatus.PAID,
      });
      if (canonical) return canonical;
    }

    return this.paymentModel
      .findOne({ orderId: order._id, status: PaymentStatus.PAID })
      .sort({ completedAt: -1, updatedAt: -1 });
  }

  /**
   * Applique un statut payin de façon idempotente et concurrente-sûre.
   *
   * Le premier appelant (webhook, cron de sync, résolution admin) qui « claim »
   * la transition terminale est le seul à appliquer les effets de bord :
   * crédit des soldes, notifications, restitution/réservation du stock.
   * Les suivants voient un `findOneAndUpdate` conditionnel vide et ne rejouent rien.
   */
  private async applyPayinStatus(payment: any, order: any, rawStatus: string, payload: any): Promise<boolean> {
    const status = normalizeDigikuntzStatus(rawStatus) || rawStatus;
    const pending = status === 'payin_pending';
    const success = status === 'payin_success';
    const failed = ['payin_error', 'payin_closed'].includes(status);
    if (!pending && !success && !failed) return false;

    // Rien à faire : un paiement PAID ne redevient jamais pending/failed.
    if (payment.status === PaymentStatus.PAID && !success) return false;

    if (pending) {
      const updated = await this.paymentModel.findOneAndUpdate(
        { _id: payment._id, status: { $in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },
        { $set: { status: PaymentStatus.PROCESSING, callbackPayload: payload } },
        { new: true },
      );
      if (updated) {
        payment.status = updated.status;
        payment.callbackPayload = updated.callbackPayload;
      }
      return !!updated;
    }

    const targetStatus = success ? PaymentStatus.PAID : PaymentStatus.FAILED;

    // Claim atomique. Un succès peut annuler un échec purement local dû à
    // l'expiration (`payment_timeout`) : le provider reste la source de vérité
    // pour un paiement réellement encaissé. En revanche un échec provider
    // confirmé (payin_error/payin_closed) n'est jamais écrasé par un succès.
    const claimFilter: Record<string, any> = success
      ? {
          _id: payment._id,
          $or: [
            { status: { $in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },
            { status: PaymentStatus.FAILED, 'callbackPayload.reason': 'payment_timeout' },
          ],
        }
      : { _id: payment._id, status: { $in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } };

    const claimed = await this.paymentModel.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          status: targetStatus,
          callbackPayload: payload,
          completedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!claimed) {
      // Transition déjà appliquée par un autre chemin : resynchroniser l'instance
      // appelante sans rejouer le moindre effet de bord.
      const current = await this.paymentModel.findById(payment._id);
      if (current) {
        payment.status = current.status;
        payment.callbackPayload = current.callbackPayload;
        payment.completedAt = current.completedAt;
      }
      return false;
    }

    payment.status = targetStatus;
    payment.callbackPayload = claimed.callbackPayload;
    payment.completedAt = claimed.completedAt;

    const currentOrder = (await this.orderModel.findById(order._id)) || order;
    order.paymentStatus = currentOrder.paymentStatus;
    order.orderStatus = currentOrder.orderStatus;
    order.paymentConfirmedAt = currentOrder.paymentConfirmedAt;
    order.paymentAnomaly = currentOrder.paymentAnomaly;

    // Une commande déjà payée par un autre paiement ne doit jamais être
    // rétrogradée ni recréditée.
    if (currentOrder.paymentStatus === PaymentStatus.PAID) return true;

    if (failed) {
      const transitioned = await this.orderModel.findOneAndUpdate(
        { _id: currentOrder._id, paymentStatus: { $ne: PaymentStatus.PAID } },
        { $set: { paymentStatus: PaymentStatus.FAILED, orderStatus: OrderStatus.PAYMENT_FAILED } },
        { new: true },
      );
      if (!transitioned) return true;

      order.paymentStatus = transitioned.paymentStatus;
      order.orderStatus = transitioned.orderStatus;

      // Restitution du stock réservé à la création de la commande.
      await this.restoreReservedStockIfCurrentCameroonDay(transitioned, 'payment_failed');
      return true;
    }

    // Succès. Si la commande avait expiré, le stock a déjà été restitué :
    // il faut le réserver de nouveau avant de valider la commande.
    const expiredLocally = currentOrder.orderStatus === OrderStatus.PAYMENT_FAILED;
    let restocked = true;
    if (expiredLocally) {
      restocked = await this.tryReserveStockForLatePayment(currentOrder);
    }

    const orderUpdate: Record<string, any> = {
      paymentStatus: PaymentStatus.PAID,
      // Source canonique unique pour la répartition, même si plusieurs
      // tentatives de paiement ont été créées pour cette commande.
      paidPaymentId: payment._id,
    };
    if (restocked) {
      orderUpdate.orderStatus = OrderStatus.PAID;
      if (!currentOrder.paymentConfirmedAt) orderUpdate.paymentConfirmedAt = new Date();
    } else {
      // Paiement réellement reçu mais commande non honorable : remboursement manuel.
      orderUpdate.paymentAnomaly = 'paid_without_stock';
    }

    const transitioned = await this.orderModel.findOneAndUpdate(
      { _id: currentOrder._id, paymentStatus: { $ne: PaymentStatus.PAID } },
      { $set: orderUpdate },
      { new: true },
    );

    if (!transitioned) {
      // La commande a été payée par un autre chemin entre-temps : annuler la
      // réservation tardive pour ne pas laisser un stock décrémenté sans commande.
      if (expiredLocally && restocked) {
        await this.restoreReservedStockIfCurrentCameroonDay(currentOrder, 'late_payment_duplicate');
      }
      return true;
    }

    order.paymentStatus = transitioned.paymentStatus;
    order.orderStatus = transitioned.orderStatus;
    order.paymentConfirmedAt = transitioned.paymentConfirmedAt;
    order.paymentAnomaly = transitioned.paymentAnomaly;

    if (!restocked) {
      this.logger.error(
        `Payment ${payment._id} received for expired order ${currentOrder._id} without enough stock — manual refund required`,
      );
      return true;
    }

    await this.creditOrderBalances(order, payment);
    const user = await this.userModel.findById(order.userId);
    if (user) await this.notifications.sendOrderConfirmed(user.email, user.phone, order.orderNumber);
    await this.notifyRestaurantStaffOrderConfirmed(order);
    return true;
  }

  /**
   * Tentative de re-réservation du stock pour un paiement reçu après expiration.
   * Tout ou rien : si un article manque, toutes les décrémentations sont annulées.
   */
  private async tryReserveStockForLatePayment(order: any): Promise<boolean> {
    if (!order?.items?.length) return true;

    const session = await this.connection.startSession();
    try {
      let insufficient = false;
      await session.withTransaction(async () => {
        for (const item of order.items) {
          try {
            await this.inventory.adjustStock(item.menuItemId, -Number(item.quantity || 0), session);
          } catch (error: any) {
            if (!/Insufficient stock/i.test(String(error?.message || ''))) throw error;
            insufficient = true;
            // Abandon de la transaction : les décréments déjà effectués
            // dans cette session sont annulés.
            throw error;
          }
        }
      });
      return true;
    } catch (error: any) {
      if (/Insufficient stock/i.test(String(error?.message || ''))) {
        this.logger.warn(
          `Late payment stock reservation failed for order ${order?._id}: insufficient stock`,
        );
        return false;
      }
      this.logger.error(`Late payment stock reservation error for order ${order?._id}: ${error?.message || error}`);
      throw error;
    } finally {
      await session.endSession();
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

    const seenOrders = new Set<string>();
    for (const payment of payments) {
      const orderKey = String(payment.orderId);
      // Une seule répartition par commande, même si plusieurs tentatives ont
      // été marquées PAID (paiement tardif après `payment_timeout`).
      if (seenOrders.has(orderKey)) continue;
      seenOrders.add(orderKey);

      try {
        const order = await this.orderModel.findById(payment.orderId);
        if (!order || order.paymentStatus !== PaymentStatus.PAID) continue;
        // Paiement reçu sans stock : remboursement manuel, jamais de crédit restaurant.
        if (order.paymentAnomaly) continue;
        // Répartition incohérente déjà signalée : correction manuelle.
        if (order.settlementError) continue;

        const canonical = await this.resolvePaidPaymentForOrder(order);
        if (!canonical) continue;
        const driverId = order.orderStatus === OrderStatus.DELIVERED ? order.assignedDriverId : undefined;
        await this.creditOrderBalances(order, canonical, driverId);
      } catch (err: any) {
        this.logger.warn(`Failed to reconcile balances for payment ${payment._id}: ${err?.message || err}`);
      }
    }
  }

  /**
   * Filet de sécurité ciblé : une commande livrée dont la part livreur n'a
   * jamais été écrite (erreur après la transition DELIVERED). Contrairement à
   * `reconcilePaidOrderBalances`, cette passe n'est pas limitée aux paiements
   * récents : elle retrouve les commandes concernées par leur statut.
   */
  @Cron('*/5 * * * *')
  async reconcileDeliveredDriverBalances() {
    if (!(await this.cronLease.acquire('payments.reconcileDelivered', 4 * 60 * 1000))) return;

    const orders = await this.orderModel
      .find({
        paymentStatus: PaymentStatus.PAID,
        orderStatus: { $in: [OrderStatus.DELIVERED, OrderStatus.CLOSED] },
        assignedDriverId: { $ne: null },
        // Marqueur de progression : une commande réglée sort de la file.
        driverShareSettledAt: null,
        // Anomalie de répartition : correction manuelle, pas de boucle cron.
        settlementError: null,
        $or: [{ paymentAnomaly: { $exists: false } }, { paymentAnomaly: null }],
      })
      // Les plus anciennes d'abord : le backlog est atteint, pas seulement
      // les 200 commandes les plus récentes.
      .sort({ updatedAt: 1 })
      .limit(200)
      .select('_id paidPaymentId restaurantId pricingSnapshot items orderStatus assignedDriverId paymentStatus');

    for (const order of orders) {
      try {
        const canonical = await this.resolvePaidPaymentForOrder(order);
        if (!canonical) continue;

        const inserted = await this.creditOrderBalances(
          order,
          canonical,
          order.assignedDriverId,
        );
        if (inserted > 0) {
          this.logger.warn(
            `Recredited missing delivery share for order ${order._id} (driver ${order.assignedDriverId})`,
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to recredit delivery share for order ${order._id}: ${err?.message || err}`,
        );
      }
    }
  }

}
