import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, timingSafeEqual } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Balance, BalanceAccountType, BalanceDocument } from '../../database/schemas/balance.schema';
import { BalanceTransaction, BalanceTransactionDocument } from '../../database/schemas/balance-transaction.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { WithdrawalRequest, WithdrawalRequestDocument, WithdrawalStatus } from '../../database/schemas/withdrawal-request.schema';
import { CronLeaseService } from '../../common/cron-lease/cron-lease.service';
import { Payment, PaymentDocument } from '../../database/schemas/payment.schema';
import { UserRole } from '../../common/enums/roles.enum';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import {
  DigikuntzIdempotencyInProgressError,
  DigikuntzProvider,
} from '../payments/providers/digikuntz.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminBalanceOperationDto } from './dto/admin-balance-operation.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { UpdateWithdrawalStatusDto } from './dto/update-withdrawal-status.dto';
import {
  detectCameroonMobileMoneyOperator,
  normalizeCameroonPhone,
} from '../../common/utils/cameroon-mobile-money.util';

function envDuration(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

@Injectable()
export class BalancesService {
  private readonly logger = new Logger(BalancesService.name);
  private isSyncingProviderWithdrawals = false;
  private isBackfillingBalances = false;

  constructor(
    @InjectModel(Balance.name) private balanceModel: Model<BalanceDocument>,
    @InjectModel(BalanceTransaction.name) private transactionModel: Model<BalanceTransactionDocument>,
    @InjectModel(WithdrawalRequest.name) private withdrawalModel: Model<WithdrawalRequestDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly digikuntzProvider: DigikuntzProvider,
    private readonly notifications: NotificationsService,
    private readonly cronLease: CronLeaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private oid(id: string | Types.ObjectId) { return new Types.ObjectId(String(id)); }

  /**
   * Clé canonique d'un scope balance (ownerType + restaurantId/userId) sous
   * forme de string. Utilisé pour matcher deux scopes même si l'un a un
   * ObjectId et l'autre un string, ou pour grouper dans un Set/Map.
   */
  private scopeKey(scope: any): string {
    const ownerType = String(scope?.ownerType || '');
    const restaurantId = scope?.restaurantId ? String(scope.restaurantId) : '';
    const userId = scope?.userId ? String(scope.userId) : '';
    return `${ownerType}|${restaurantId}|${userId}`;
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }

  private assertWithdrawalWebhookAuthenticated(providedToken?: string) {
    const expected = process.env.DIGIKUNTZ_WEBHOOK_SECRET;
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('DIGIKUNTZ_WEBHOOK_SECRET is not configured — refusing withdrawal webhook in production');
        throw new UnauthorizedException('Webhook authentication is not configured');
      }
      this.logger.warn('DIGIKUNTZ_WEBHOOK_SECRET is not configured — withdrawal webhook is unauthenticated (dev mode only)');
      return;
    }
    if (!providedToken || !this.constantTimeEquals(providedToken, expected)) {
      this.logger.warn('Rejected DigiKuntz withdrawal webhook with invalid or missing token');
      throw new UnauthorizedException('Invalid webhook token');
    }
  }

  private balanceAccountForScope(scope: any): { accountType: BalanceAccountType; ownerId: string } {
    if (scope.ownerType === 'restaurant') return { accountType: 'restaurant', ownerId: String(scope.restaurantId) };
    if (scope.ownerType === 'user') return { accountType: 'driver', ownerId: String(scope.userId) };
    return { accountType: 'system', ownerId: '0000000' };
  }

  private async balanceFor(scope: any, session?: ClientSession): Promise<number> {
    // Le ledger BalanceTransaction est l'unique source de vérité :
    // - retrait initié/en attente => withdrawal_request débitée
    // - retrait échoué/rejeté => withdrawal_refund créditée
    // Tant qu'il n'y a pas de refund, le solde reste donc débité.
    return this.refreshCachedBalance(scope, session);
  }

  /**
   * Calcul autoritaire du solde pour un scope donné. On ne dépend plus du
   * statut WithdrawalRequest pour éviter qu'un retrait `pending` soit
   * recrédité par erreur lors d'un refresh/backfill.
   */
  private async computeBalanceFromSources(scope: any, session?: ClientSession): Promise<number> {
    const btsMatch: any = {
      ownerType: scope.ownerType,
    };
    if (scope.ownerType === 'restaurant') {
      btsMatch.restaurantId = scope.restaurantId;
    } else if (scope.ownerType === 'user') {
      btsMatch.userId = scope.userId;
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
    return this.toBalanceInteger(Number(btRow?.total || 0));
  }

  private async refreshCachedBalance(scope: any, session?: ClientSession): Promise<number> {
    const account = this.balanceAccountForScope(scope);
    const balance = await this.computeBalanceFromSources(scope, session);
    await this.balanceModel.updateOne(
      account,
      {
        $set: {
          ...account,
          balance,
          currency: 'XAF',
        },
      },
      { upsert: true, session },
    );
    return balance;
  }

  private toBalanceInteger(value: any): number {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 0;
    const sign = amount < 0 ? -1 : 1;
    return sign * Math.floor(Math.abs(amount));
  }

  private async recordBalanceTransaction(payload: any, session?: ClientSession) {
    const amount = this.toBalanceInteger(payload.amount);
    payload.amount = amount;
    const account = this.balanceAccountForScope(payload);
    const [transaction] = await this.transactionModel.create([payload], { session });
    // NB: pas de `balance: 0` dans $setOnInsert — conflit avec $inc.
    // Le default du schema (et la sémantique de $inc à l'insert qui démarre
    // de 0) garantit la cohérence.
    await this.balanceModel.updateOne(
      account,
      {
        $setOnInsert: { ...account, currency: payload.currency || 'XAF' },
        $inc: { balance: amount },
      },
      { upsert: true, session },
    );
    return transaction;
  }

  /**
   * Helper IDEMPOTENT pour les mouvements de solde rattachés à un événement
   * métier unique (withdrawal request/refund, order share, etc.).
   *
   * Le `filter` doit identifier le couple **(transaction métier, action)**
   * — typiquement `{ withdrawalId, reason: 'withdrawal_request' }` ou
   * `{ orderId, reason: 'order_restaurant_share' }`.
   *
   * Garantie cross-service/cron : même si plusieurs threads (cron de sync,
   * webhook DigiKuntz, retry…) appellent simultanément cette méthode avec
   * le même filtre, le `$inc` sur la Balance ne s'applique **qu'une seule
   * fois** (celui qui gagne la course d'insertion). Les threads perdants
   * voient l'existant et ne font rien.
   */
  private async upsertBalanceTransaction(filter: any, payload: any, session?: ClientSession) {
    const nextAmount = this.toBalanceInteger(payload.amount);
    payload.amount = nextAmount;
    const account = this.balanceAccountForScope(payload);

    const result = await this.transactionModel.updateOne(
      filter,
      { $setOnInsert: payload },
      { upsert: true, session },
    );

    const inserted = Number(result.upsertedCount || 0) > 0
      || !!(result as any).upsertedId;
    if (inserted && nextAmount !== 0) {
      await this.balanceModel.updateOne(
        account,
        {
          $setOnInsert: { ...account, currency: payload.currency || 'XAF' },
          $inc: { balance: nextAmount },
        },
        { upsert: true, session },
      );
    }
    // On ré-expose `inserted` + le résultat brut pour les call-sites qui
    // doivent savoir si c'est cet appel-ci qui a appliqué le mouvement
    // (utile pour les notifications, refund flags, etc.).
    return { ...result, inserted };
  }

  private scopeForActor(actor: any) {
    if (actor.role === UserRole.DRIVER) return { ownerType: 'user', userId: this.oid(actor.sub) };
    if ([UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role)) {
      if (!actor.restaurantId) throw new ForbiddenException('Restaurant context is required');
      return { ownerType: 'restaurant', restaurantId: this.oid(actor.restaurantId) };
    }
    if (actor.role === UserRole.ADMIN) return { ownerType: 'system' };
    throw new ForbiddenException('No balance available for this role');
  }

  private scopeForWithdrawal(withdrawal: WithdrawalRequestDocument) {
    if (withdrawal.ownerType === 'restaurant') {
      return { ownerType: 'restaurant', restaurantId: withdrawal.restaurantId };
    }
    if (withdrawal.ownerType === 'user') {
      return { ownerType: 'user', userId: withdrawal.userId };
    }
    return { ownerType: 'system' };
  }

  /**
   * Recalcule chaque `Balance` à partir de la somme de ses `BalanceTransaction`.
   * Idempotent : sûr de l'appeler à tout moment, manuellement ou via le cron.
   */
  async runBalancesBackfill() {
    return this.backfillBalancesFromTransactions();
  }

  @Cron('*/5 * * * *')
  async backfillBalancesFromTransactions() {
    // Multi-instance safe : seul un nœud détient le lease à la fois (TTL 4 min,
    // donc strictement inférieur à l'intervalle 5 min pour libérer entre ticks).
    if (!(await this.cronLease.acquire('balances.backfill', 4 * 60 * 1000))) return;
    if (this.isBackfillingBalances) return;
    this.isBackfillingBalances = true;
    try {
      // Le solde est la somme du ledger. Un retrait pending reste débité via
      // `withdrawal_request`; un échec ajoute `withdrawal_refund`.
      const bts = await this.transactionModel.aggregate([
        { $match: {} },
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
        {
          $group: {
            _id: {
              ownerType: '$ownerType',
              restaurantId: '$restaurantId',
              userId: '$userId',
            },
            balance: { $sum: '$amount' },
            currency: { $first: '$currency' },
          },
        },
      ]);

      const map = new Map<string, { scope: any; balance: number; currency?: string }>();
      for (const row of bts) {
        // Le compte système est unique (`0000000`) : les lignes système
        // peuvent porter un userId/restaurantId (financement admin), elles
        // doivent donc être additionnées, jamais écrasées l'une par l'autre.
        const scope = row._id.ownerType === 'system'
          ? { ownerType: 'system', restaurantId: null, userId: null }
          : row._id;
        const key = this.scopeKey(scope);
        const current = map.get(key);
        if (current) {
          current.balance += Number(row.balance || 0);
        } else {
          map.set(key, {
            scope,
            balance: Number(row.balance || 0),
            currency: row.currency,
          });
        }
      }

      for (const { scope: scopeId, balance, currency } of map.values()) {
        const scope = scopeId.ownerType === 'restaurant'
          ? { ownerType: 'restaurant', restaurantId: scopeId.restaurantId }
          : scopeId.ownerType === 'user'
            ? { ownerType: 'user', userId: scopeId.userId }
            : { ownerType: 'system' };
        const account = this.balanceAccountForScope(scope);
        const finalBalance = this.toBalanceInteger(balance);
        await this.balanceModel.updateOne(
          account,
          {
            $set: {
              ...account,
              balance: finalBalance,
              currency: currency || 'XAF',
            },
          },
          { upsert: true },
        );
      }
    } catch (error: any) {
      this.logger.warn(`Failed to backfill balances: ${error?.message || error}`);
    } finally {
      this.isBackfillingBalances = false;
    }
  }

  async summary(actor: any) {
    const scope = this.scopeForActor(actor);
    const account = this.balanceAccountForScope(scope);
    const ledgerBalance = await this.balanceFor(scope);
    return {
      ownerType: scope.ownerType,
      accountType: account.accountType,
      ownerId: account.ownerId,
      balance: ledgerBalance,
      currency: 'XAF',
    };
  }

  async transactions(actor: any, page?: number, limit?: number) {
    const scope = this.scopeForActor(actor);
    const pagination = normalizePagination(page, limit);
    const [data, total] = await Promise.all([
      this.transactionModel.find(scope).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
      this.transactionModel.countDocuments(scope),
    ]);
    return { data, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
  }

  async ledger(
    actor: any,
    page?: number,
    limit?: number,
    filters?: { q?: string; status?: string; type?: string; from?: string; to?: string },
  ) {
    const pagination = normalizePagination(page, limit);
    const fetchLimit = pagination.page * pagination.limit;
    const isAdmin = actor.role === UserRole.ADMIN;
    const isManager = actor.role === UserRole.MANAGER;
    const isEmployee = actor.role === UserRole.EMPLOYEE;
    const isDriver = actor.role === UserRole.DRIVER;

    if (!isAdmin && !isManager && !isEmployee && !isDriver) {
      throw new ForbiddenException('Transactions are not available for this role');
    }
    if ((isManager || isEmployee) && !actor.restaurantId) {
      throw new ForbiddenException('Restaurant context is required');
    }

    const restaurantId = actor.restaurantId ? this.oid(actor.restaurantId) : null;
    const driverId = isDriver ? this.oid(actor.sub) : null;
    const restaurantOrders = restaurantId
      ? await this.orderModel.find({ restaurantId }).select('_id orderNumber')
      : [];
    const restaurantOrderIds = restaurantOrders.map((order) => order._id);
    const q = String(filters?.q || '').trim();
    const qRegex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    const type = String(filters?.type || '').trim();
    const status = String(filters?.status || '').trim();
    const range = isEmployee
      ? this.doualaDayRange(new Date())
      : this.requestedDateRange(filters?.from, filters?.to);

    const paymentFilter: any = {};
    const balanceFilter: any = {};
    const withdrawalFilter: any = {};

    if (isManager || isEmployee) paymentFilter.orderId = { $in: restaurantOrderIds };
    if (isDriver) paymentFilter._id = { $exists: false };
    if (isEmployee) {
      paymentFilter.createdAt = range;
    } else if (range) {
      paymentFilter.createdAt = range;
      balanceFilter.createdAt = range;
      withdrawalFilter.createdAt = range;
    }

    if (isManager) {
      balanceFilter.ownerType = 'restaurant';
      balanceFilter.restaurantId = restaurantId;
      withdrawalFilter.ownerType = 'restaurant';
      withdrawalFilter.restaurantId = restaurantId;
    } else if (isDriver) {
      balanceFilter.ownerType = 'user';
      balanceFilter.userId = driverId;
      withdrawalFilter.ownerType = 'user';
      withdrawalFilter.userId = driverId;
    }

    // Le retrait est représenté par WithdrawalRequest, pas une seconde fois par
    // son débit/remboursement technique dans BalanceTransaction.
    balanceFilter.$or = [
      { withdrawalId: { $exists: false } },
      { withdrawalId: null },
    ];

    if (status) {
      paymentFilter.status = status;
      withdrawalFilter.status = status;
      if (status !== 'completed') balanceFilter._id = { $exists: false };
    }

    if (type === 'payment') {
      balanceFilter._id = { $exists: false };
      withdrawalFilter._id = { $exists: false };
    } else if (type === 'withdrawal') {
      paymentFilter._id = { $exists: false };
      balanceFilter._id = { $exists: false };
    } else if (type === 'credit' || type === 'debit') {
      paymentFilter._id = { $exists: false };
      withdrawalFilter._id = { $exists: false };
      balanceFilter.type = type;
    }

    if (isEmployee) {
      balanceFilter._id = { $exists: false };
      withdrawalFilter._id = { $exists: false };
    }

    if (qRegex) {
      const matchingOrders = await this.orderModel.find({
        ...(restaurantId ? { restaurantId } : {}),
        orderNumber: qRegex,
      }).select('_id');
      paymentFilter.$and = [
        ...(paymentFilter.$and || []),
        {
          $or: [
            { provider: qRegex },
            { status: qRegex },
            { providerRef: qRegex },
            { transactionRef: qRegex },
            { orderId: { $in: matchingOrders.map((order) => order._id) } },
          ],
        },
      ];
      balanceFilter.$and = [
        ...(balanceFilter.$and || []),
        { $or: [{ reason: qRegex }, { note: qRegex }, { currency: qRegex }] },
      ];
      withdrawalFilter.$and = [
        ...(withdrawalFilter.$and || []),
        {
          $or: [
            { phone: qRegex },
            { status: qRegex },
            { provider: qRegex },
            { providerRef: qRegex },
            { transactionRef: qRegex },
            { note: qRegex },
          ],
        },
      ];
    }

    const includePayments = !paymentFilter._id || paymentFilter._id.$exists !== false;
    const includeBalances = !balanceFilter._id || balanceFilter._id.$exists !== false;
    const includeWithdrawals = !withdrawalFilter._id || withdrawalFilter._id.$exists !== false;

    const [payments, balances, withdrawals, paymentCount, balanceCount, withdrawalCount, paidSummary] = await Promise.all([
      includePayments
        ? this.paymentModel.find(paymentFilter)
            .populate({
              path: 'orderId',
              populate: [
                { path: 'restaurantId', select: 'name slug logo' },
                { path: 'userId', select: 'firstName lastName email phone' },
              ],
            })
            .sort({ createdAt: -1 }).limit(fetchLimit).lean()
        : [],
      includeBalances
        ? this.transactionModel.find(balanceFilter)
            .populate('restaurantId', 'name slug logo')
            .populate('userId', 'firstName lastName email phone role')
            .populate('orderId', 'orderNumber')
            .populate('createdBy', 'firstName lastName email role')
            .sort({ createdAt: -1 }).limit(fetchLimit).lean()
        : [],
      includeWithdrawals
        ? this.withdrawalModel.find(withdrawalFilter)
            .populate('restaurantId', 'name slug logo')
            .populate('userId', 'firstName lastName email phone role')
            .populate('requestedBy', 'firstName lastName email phone role')
            .sort({ createdAt: -1 }).limit(fetchLimit).lean()
        : [],
      includePayments ? this.paymentModel.countDocuments(paymentFilter) : 0,
      includeBalances ? this.transactionModel.countDocuments(balanceFilter) : 0,
      includeWithdrawals ? this.withdrawalModel.countDocuments(withdrawalFilter) : 0,
      includePayments
        ? this.paymentModel.aggregate([
            { $match: { ...paymentFilter, status: 'paid' } },
            { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
          ])
        : [],
    ]);

    const data = [
      ...payments.map((payment: any) => ({
        _id: String(payment._id),
        source: 'payment',
        type: 'payment',
        direction: 'credit',
        label: 'Encaissement commande',
        amount: Number(payment.amount || 0),
        currency: payment.currency || 'XAF',
        status: payment.status,
        provider: payment.provider,
        providerRef: payment.providerRef,
        transactionRef: payment.transactionRef,
        order: payment.orderId || null,
        restaurant: payment.orderId?.restaurantId || null,
        user: payment.orderId?.userId || null,
        createdAt: payment.createdAt || payment.initiatedAt,
      })),
      ...balances.map((transaction: any) => ({
        _id: String(transaction._id),
        source: 'balance',
        type: transaction.type,
        direction: transaction.type,
        label: this.balanceReasonLabel(transaction.reason),
        amount: Math.abs(Number(transaction.amount || 0)),
        signedAmount: Number(transaction.amount || 0),
        currency: transaction.currency || 'XAF',
        status: 'completed',
        reason: transaction.reason,
        note: transaction.note,
        order: transaction.orderId || null,
        restaurant: transaction.restaurantId || null,
        user: transaction.userId || null,
        createdBy: transaction.createdBy || null,
        createdAt: transaction.createdAt,
      })),
      ...withdrawals.map((withdrawal: any) => ({
        _id: String(withdrawal._id),
        source: 'withdrawal',
        type: 'withdrawal',
        direction: 'debit',
        // `approved` est un statut hérité (avant la refonte) : on l'expose
        // comme `pending` au consommateur pour qu'il s'affiche en « En cours »,
        // même si le document en base n'a pas encore été ré-évalué par le cron.
        status: withdrawal.status === 'approved' ? 'pending' : withdrawal.status,
        label: 'Retrait de solde',
        amount: Number(withdrawal.amount || 0),
        currency: withdrawal.currency || 'XAF',
        provider: withdrawal.provider,
        providerRef: withdrawal.providerRef,
        transactionRef: withdrawal.transactionRef,
        phone: withdrawal.phone,
        accountBankCode: withdrawal.accountBankCode,
        // Filtre les notes polluées par d'anciens écrasements avec le statut
        // provider (« payout_pending », « payin_success », etc.) pour ne pas
        // les afficher comme libellé utilisateur.
        note: /^(payin_|payout_)/.test(String(withdrawal.note || ''))
          ? undefined
          : withdrawal.note,
        restaurant: withdrawal.restaurantId || null,
        user: withdrawal.userId || withdrawal.requestedBy || null,
        createdAt: withdrawal.createdAt,
      })),
    ]
      .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(pagination.skip, pagination.skip + pagination.limit);

    const total = paymentCount + balanceCount + withdrawalCount;
    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
      summary: {
        totalTransactions: total,
        paidCount: Number(paidSummary[0]?.count || 0),
        paidAmount: Number(paidSummary[0]?.amount || 0),
        period: isEmployee ? 'today' : 'filtered',
      },
    };
  }

  private requestedDateRange(from?: string, to?: string) {
    const range: any = {};
    if (from) {
      const start = new Date(`${from}T00:00:00+01:00`);
      if (!Number.isNaN(start.getTime())) range.$gte = start;
    }
    if (to) {
      const end = new Date(`${to}T23:59:59.999+01:00`);
      if (!Number.isNaN(end.getTime())) range.$lte = end;
    }
    return Object.keys(range).length ? range : null;
  }

  private doualaDayRange(date: Date) {
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Douala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    return {
      $gte: new Date(`${key}T00:00:00+01:00`),
      $lte: new Date(`${key}T23:59:59.999+01:00`),
    };
  }

  private balanceReasonLabel(reason?: string) {
    const labels: Record<string, string> = {
      admin_driver_credit: 'Crédit livreur par admin',
      admin_driver_debit: 'Débit livreur par admin',
      admin_restaurant_credit: 'Crédit restaurant par admin',
      admin_restaurant_debit: 'Débit restaurant par admin',
      driver_funding: 'Financement du solde livreur',
      restaurant_funding: 'Financement du solde restaurant',
      order_restaurant_share: 'Part restaurant sur commande',
      order_delivery_share: 'Part livraison',
      order_system_share: 'Part système sur commande',
      withdrawal_request: 'Retrait de solde',
      withdrawal_refund: 'Remboursement de retrait',
    };
    return labels[String(reason || '')] || String(reason || 'Mouvement de solde').replace(/_/g, ' ');
  }

  async withdrawals(actor: any, page?: number, limit?: number) {
    const scope = this.scopeForActor(actor);
    const pagination = normalizePagination(page, limit);
    const filter = scope.ownerType === 'system' ? {} : scope;
    const [data, total] = await Promise.all([
      this.withdrawalModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
      this.withdrawalModel.countDocuments(filter),
    ]);
    return { data, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
  }

  /**
   * Retraits nécessitant une action manuelle : fonds retenus sans
   * confirmation provider, TTL d'idempotence dépassée, ou succès provider
   * arrivé après un remboursement.
   */
  async listWithdrawalsForReconciliation(page?: number, limit?: number) {
    const pagination = normalizePagination(page, limit);
    const filter = {
      $or: [
        {
          status: 'gateway_unavailable',
          providerStatus: {
            $in: [
              'manual_reconciliation_required',
              'unverified_timeout',
              'idempotency_in_progress',
            ],
          },
        },
        { lateProviderSuccessAt: { $ne: null } },
      ],
    };
    const [data, total] = await Promise.all([
      this.withdrawalModel
        .find(filter)
        .sort({ updatedAt: 1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.withdrawalModel.countDocuments(filter),
    ]);
    return { data, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
  }

  private assertAdmin(actor: any) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Only admin can manage balances');
  }

  private normalizeAmount(dto: AdminBalanceOperationDto) {
    const amount = Math.floor(Number(dto.amount || 0));
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    return Math.floor(amount);
  }

  private async findDriverOrFail(driverId: string) {
    const driver = await this.userModel.findById(driverId);
    if (!driver) throw new NotFoundException('Driver not found');
    if (driver.role !== UserRole.DRIVER) throw new BadRequestException('Selected user is not a driver');
    return driver;
  }

  private async findRestaurantOrFail(restaurantId: string) {
    const restaurant = await this.restaurantModel.findById(restaurantId);
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    return restaurant;
  }

  private userDisplayName(user: any) {
    return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || user?.phone || 'Bénéficiaire';
  }

  private normalizeWithdrawalPhone(phone: string) {
    return `237${normalizeCameroonPhone(phone)}`;
  }

  /**
   * Tente d'extraire le `message` JSON d'une chaîne d'erreur provider
   * (typiquement `"DigiKuntz payout error: {\"statusCode\":409,\"message\":\"Insufficient balance\"...}"`).
   * Renvoie une chaîne lisible utilisateur, ou la chaîne brute en dernier
   * recours.
   */
  private extractProviderErrorMessage(rawError: string): string {
    if (!rawError) return '';
    const jsonStart = rawError.indexOf('{');
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(rawError.slice(jsonStart));
        const message = parsed?.message;
        if (Array.isArray(message)) return message.join(', ');
        if (typeof message === 'string') return message;
      } catch {
        /* fallthrough */
      }
    }
    return rawError.replace(/^DigiKuntz payout error:\s*/i, '').slice(0, 240);
  }

  private localStatusForProviderStatus(status?: string): WithdrawalStatus | null {
    // `payout_pending` est renvoyé par DigiKuntz à l'initiation ET pendant le
    // traitement par l'admin DigiKuntz (avant Flutterwave). Côté Eat, on garde
    // le retrait en `pending` (« En attente ») jusqu'à ce qu'un état FINAL
    // arrive (success/error/closed/rejected).
    if (status === 'payout_pending') return 'pending';
    if (status === 'payout_success') return 'paid';
    if (['payout_error', 'payout_closed', 'payout_rejected'].includes(status || '')) return 'failed';
    return null;
  }


  async driverBalance(driverId: string, actor: any) {
    this.assertAdmin(actor);
    const driver = await this.findDriverOrFail(driverId);
    return {
      ownerType: 'user',
      accountType: 'driver',
      userId: driver._id,
      ownerId: String(driver._id),
      balance: await this.balanceFor({ ownerType: 'user', userId: driver._id }),
      currency: 'XAF',
    };
  }

  async restaurantBalance(restaurantId: string, actor: any) {
    this.assertAdmin(actor);
    const restaurant = await this.findRestaurantOrFail(restaurantId);
    return {
      ownerType: 'restaurant',
      accountType: 'restaurant',
      restaurantId: restaurant._id,
      ownerId: String(restaurant._id),
      balance: await this.balanceFor({ ownerType: 'restaurant', restaurantId: restaurant._id }),
      currency: 'XAF',
    };
  }

  async creditDriver(driverId: string, dto: AdminBalanceOperationDto, actor: any) {
    this.assertAdmin(actor);
    const amount = this.normalizeAmount(dto);
    const driver = await this.findDriverOrFail(driverId);
    const createdBy = this.oid(actor.sub);
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const mainBalance = await this.balanceFor({ ownerType: 'system' }, session);
        if (amount > mainBalance) throw new BadRequestException('Insufficient main balance');

        const systemDebit = await this.recordBalanceTransaction(
          { ownerType: 'system', amount: -amount, type: 'debit', reason: 'driver_funding', userId: driver._id, createdBy, note: dto.note, currency: 'XAF' },
          session,
        );
        const driverCredit = await this.recordBalanceTransaction(
          { ownerType: 'user', userId: driver._id, amount, type: 'credit', reason: 'admin_driver_credit', createdBy, note: dto.note, currency: 'XAF' },
          session,
        );
        result = {
          systemDebit,
          driverCredit,
          driverBalance: await this.balanceFor({ ownerType: 'user', userId: driver._id }, session),
          systemBalance: await this.balanceFor({ ownerType: 'system' }, session),
        };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async debitDriver(driverId: string, dto: AdminBalanceOperationDto, actor: any) {
    this.assertAdmin(actor);
    const amount = this.normalizeAmount(dto);
    const driver = await this.findDriverOrFail(driverId);
    const createdBy = this.oid(actor.sub);
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const driverBalance = await this.balanceFor({ ownerType: 'user', userId: driver._id }, session);
        if (amount > driverBalance) throw new BadRequestException('Insufficient driver balance');

        const transaction = await this.recordBalanceTransaction({
          ownerType: 'user',
          userId: driver._id,
          amount: -amount,
          type: 'debit',
          reason: 'admin_driver_debit',
          createdBy,
          note: dto.note,
          currency: 'XAF',
        }, session);
        result = {
          transaction,
          driverBalance: await this.balanceFor({ ownerType: 'user', userId: driver._id }, session),
        };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async creditRestaurant(restaurantId: string, dto: AdminBalanceOperationDto, actor: any) {
    this.assertAdmin(actor);
    const amount = this.normalizeAmount(dto);
    const restaurant = await this.findRestaurantOrFail(restaurantId);
    const createdBy = this.oid(actor.sub);
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const mainBalance = await this.balanceFor({ ownerType: 'system' }, session);
        if (amount > mainBalance) throw new BadRequestException('Insufficient main balance');

        const systemDebit = await this.recordBalanceTransaction(
          { ownerType: 'system', amount: -amount, type: 'debit', reason: 'restaurant_funding', restaurantId: restaurant._id, createdBy, note: dto.note, currency: 'XAF' },
          session,
        );
        const restaurantCredit = await this.recordBalanceTransaction(
          { ownerType: 'restaurant', restaurantId: restaurant._id, amount, type: 'credit', reason: 'admin_restaurant_credit', createdBy, note: dto.note, currency: 'XAF' },
          session,
        );
        result = {
          systemDebit,
          restaurantCredit,
          restaurantBalance: await this.balanceFor({ ownerType: 'restaurant', restaurantId: restaurant._id }, session),
          systemBalance: await this.balanceFor({ ownerType: 'system' }, session),
        };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async debitRestaurant(restaurantId: string, dto: AdminBalanceOperationDto, actor: any) {
    this.assertAdmin(actor);
    const amount = this.normalizeAmount(dto);
    const restaurant = await this.findRestaurantOrFail(restaurantId);
    const createdBy = this.oid(actor.sub);
    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const restaurantBalance = await this.balanceFor({ ownerType: 'restaurant', restaurantId: restaurant._id }, session);
        if (amount > restaurantBalance) throw new BadRequestException('Insufficient restaurant balance');

        const transaction = await this.recordBalanceTransaction({
          ownerType: 'restaurant',
          restaurantId: restaurant._id,
          amount: -amount,
          type: 'debit',
          reason: 'admin_restaurant_debit',
          createdBy,
          note: dto.note,
          currency: 'XAF',
        }, session);
        result = {
          transaction,
          restaurantBalance: await this.balanceFor({ ownerType: 'restaurant', restaurantId: restaurant._id }, session),
        };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async createWithdrawal(actor: any, dto: CreateWithdrawalDto) {
    if (![UserRole.ADMIN, UserRole.MANAGER, UserRole.DRIVER].includes(actor.role)) {
      throw new ForbiddenException('Only admins, managers and drivers can request withdrawals');
    }
    const scope = this.scopeForActor(actor);
    const amount = Math.floor(Number(dto.amount || 0));
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const accountBankCode = detectCameroonMobileMoneyOperator(dto.phone);
    if (!accountBankCode) {
      throw new BadRequestException('Unsupported MTN Mobile Money or Orange Money number');
    }

    const actorId = this.oid(actor.sub);
    // Sans clé client, une clé déterministe par minute protège aussi les
    // double-clics concurrents (l'index unique tranche, pas un read-then-act).
    if (String(dto.idempotencyKey || '').startsWith('svc:')) {
      throw new BadRequestException('Reserved idempotency key prefix');
    }
    const idempotencyKey = String(dto.idempotencyKey || '').trim()
      || this.autoIdempotencyKey(actorId, amount, dto.phone);

    // 1) Rejeu idempotent : une même clé ne crée jamais un second retrait.
    const existing = await this.withdrawalModel.findOne({
      requestedBy: actorId,
      idempotencyKey,
    });
    if (existing) {
      const sameScope =
        existing.ownerType === scope.ownerType &&
        String(existing.restaurantId || '') === String(scope.restaurantId || '') &&
        String(existing.userId || '') === String(scope.userId || '');
      if (
        !sameScope ||
        Number(existing.amount) !== amount ||
        existing.phone !== dto.phone ||
        existing.accountBankCode !== accountBankCode
      ) {
        throw new ConflictException(
          'Idempotency key already used with different withdrawal parameters',
        );
      }
      return this.replayWithdrawal(existing, 'idempotent_replay');
    }

    // 2) Sans clé client, tant qu'un retrait identique est non résolu
    //    (pending/gateway_unavailable/approved), on renvoie ce retrait au
    //    lieu d'en créer un second. La fenêtre couvre toute la durée de
    //    résolution, pas seulement 60 secondes.
    if (!dto.idempotencyKey) {
      const unresolved = await this.withdrawalModel
        .findOne({
          requestedBy: actorId,
          amount,
          phone: dto.phone,
          status: { $in: ['pending', 'gateway_unavailable', 'approved'] },
        })
        .sort({ createdAt: -1 });
      if (unresolved) {
        return this.replayWithdrawal(unresolved, 'recent_duplicate');
      }
    }

    // 3) Précheck rapide hors transaction (le re-check transactionnel reste
    //    la référence).
    const preAvailable = await this.balanceFor(scope);
    if (amount > preAvailable) throw new BadRequestException('Insufficient balance');

    // 4) Persister le retrait ET débiter le solde AVANT l'appel provider.
    //    Un payout accepté ne peut donc plus exister sans trace locale.
    const withdrawalId = new Types.ObjectId();
    const now = new Date();
    let debit: any = null;
    let balanceAfter = 0;
    let created: any = null;

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const available = await this.balanceFor(scope, session);
        if (amount > available) throw new BadRequestException('Insufficient balance');

        const [withdrawal] = await this.withdrawalModel.create([{
          _id: withdrawalId,
          ...scope,
          requestedBy: actorId,
          idempotencyKey,
          amount,
          phone: dto.phone,
          accountBankCode,
          currency: 'XAF',
          // État initial : le payout n'est pas encore confirmé. Si le
          // processus s'arrête avant l'appel provider, le cron de retry
          // reprend l'initiation avec la même clé d'idempotence.
          status: 'gateway_unavailable',
          provider: 'digikuntz',
          providerStatus: 'initiating',
          gatewayUnavailableSince: now,
          gatewayUnavailableAttempts: 0,
          lastGatewayRetryAt: now,
          nextGatewayRetryAt: new Date(now.getTime() + this.minGatewayRetryIntervalMs),
        }], { session });

        debit = await this.recordBalanceTransaction({
          ...scope,
          withdrawalId: withdrawal._id,
          amount: -amount,
          type: 'debit',
          reason: 'withdrawal_request',
          currency: 'XAF',
          note: `Retrait ${accountBankCode === 'MTN' ? 'MTN Mobile Money' : 'Orange Money'} ${dto.phone}`,
          createdBy: actorId,
        }, session);

        balanceAfter = await this.refreshCachedBalance(scope, session);
        created = withdrawal;

        this.logger.log(
          `Withdrawal ${withdrawal._id} persisted before payout — amount=${amount}, balanceBefore=${available}, balanceAfter=${balanceAfter}`,
        );
      });
    } catch (error: any) {
      // Deux requêtes concurrentes avec la même clé (client ou auto) :
      // l'index unique tranche. On renvoie le retrait gagnant si visible,
      // sinon un 409 explicite (jamais un 500 brut).
      if (error?.code === 11000) {
        const duplicate = await this.withdrawalModel.findOne({
          requestedBy: actorId,
          idempotencyKey,
        });
        if (duplicate) {
          return this.replayWithdrawal(duplicate, 'idempotent_replay');
        }
        throw new ConflictException('Withdrawal creation already in progress');
      }
      throw error;
    } finally {
      await session.endSession();
    }

    // 5) Appel provider APRÈS le commit. La clé d'idempotence provider est
    //    l'ID du retrait : un retry ne peut pas créer un second payout.
    const requester = await this.userModel.findById(actorId);
    const outcome = await this.callDigikuntzPayoutOutcome({
      amount,
      phone: dto.phone,
      accountBankCode,
      receiverName: this.userDisplayName(requester),
      narration: `Retrait Eat App ${withdrawalId}`,
      idempotencyKey: String(withdrawalId),
    });

    if (outcome.kind === 'provider_error') {
      const transition = await this.transitionWithdrawalStatus(
        String(withdrawalId),
        'failed',
        outcome.providerMessage,
        actor.sub,
        {
          providerStatus: 'payout_error',
          providerPayload: {
            error: outcome.rawError,
            providerMessage: outcome.providerMessage,
          },
        } as any,
        // Refus synchrone : le client reçoit déjà le 400 avec le message,
        // inutile de notifier tous les admins.
        { notify: false },
      );
      const withdrawal = transition?.withdrawal || created;
      this.recordWithdrawalAudit(
        actor,
        withdrawal,
        amount,
        dto.phone,
        idempotencyKey,
        'failed',
      );
      throw new BadRequestException(
        outcome.providerMessage || 'Retrait refusé par le service de paiement.',
      );
    }

    if (outcome.kind === 'idempotency_in_progress') {
      const transition = await this.transitionWithdrawalStatus(
        String(withdrawalId),
        'gateway_unavailable',
        undefined,
        actor.sub,
        {
          providerStatus: 'idempotency_in_progress',
          providerPayload: {
            reason: 'idempotency_in_progress',
            error: outcome.rawError,
            attemptedAt: new Date().toISOString(),
          },
          lastGatewayRetryAt: new Date(),
          // Le provider bloque la clé jusqu'à 24 h : on re-tente avec un
          // backoff long, sans jamais rembourser.
          nextGatewayRetryAt: new Date(Date.now() + 15 * 60 * 1000),
          gatewayUnavailableAttempts: 1,
        } as any,
      );
      const withdrawal = transition?.withdrawal || created;
      this.recordWithdrawalAudit(
        actor,
        withdrawal,
        amount,
        dto.phone,
        idempotencyKey,
        'gateway_unavailable',
      );
      return {
        withdrawal,
        debit,
        balance: transition?.balance ?? balanceAfter,
        execution: { withdrawal, balance: transition?.balance ?? balanceAfter },
      };
    }

    if (outcome.kind === 'gateway_unavailable') {
      const transition = await this.transitionWithdrawalStatus(
        String(withdrawalId),
        'gateway_unavailable',
        undefined,
        actor.sub,
        {
          providerStatus: 'gateway_unavailable',
          providerPayload: {
            reason: 'gateway_unavailable',
            error: outcome.rawError,
            attemptedAt: new Date().toISOString(),
          },
          lastGatewayRetryAt: new Date(),
          nextGatewayRetryAt: new Date(Date.now() + this.minGatewayRetryIntervalMs),
          gatewayUnavailableAttempts: 1,
        } as any,
      );
      const withdrawal = transition?.withdrawal || created;
      this.recordWithdrawalAudit(
        actor,
        withdrawal,
        amount,
        dto.phone,
        idempotencyKey,
        'gateway_unavailable',
      );
      return {
        withdrawal,
        debit,
        balance: transition?.balance ?? balanceAfter,
        execution: { withdrawal, balance: transition?.balance ?? balanceAfter },
      };
    }

    // Un succès sans référence exploitable ne doit pas rester `pending` :
    // aucun cron ne pourrait le retrouver. On repasse par le retry avec la
    // même clé d'idempotence provider.
    if (!outcome.providerRef && !outcome.transactionRef) {
      const transition = await this.transitionWithdrawalStatus(
        String(withdrawalId),
        'gateway_unavailable',
        undefined,
        actor.sub,
        {
          providerStatus: 'missing_provider_reference',
          providerPayload: {
            reason: 'missing_provider_reference',
            providerStatus: outcome.providerStatus,
            providerPayload: outcome.providerPayload,
            attemptedAt: new Date().toISOString(),
          },
          lastGatewayRetryAt: new Date(),
          nextGatewayRetryAt: new Date(Date.now() + this.minGatewayRetryIntervalMs),
          gatewayUnavailableAttempts: 1,
        } as any,
      );
      const withdrawal = transition?.withdrawal || created;
      this.recordWithdrawalAudit(
        actor,
        withdrawal,
        amount,
        dto.phone,
        idempotencyKey,
        'gateway_unavailable',
      );
      return {
        withdrawal,
        debit,
        balance: transition?.balance ?? balanceAfter,
        execution: { withdrawal, balance: transition?.balance ?? balanceAfter },
      };
    }

    const nextStatus = this.localStatusForProviderStatus(outcome.providerStatus) || 'pending';
    const transition = await this.transitionWithdrawalStatus(
      String(withdrawalId),
      nextStatus,
      undefined,
      actor.sub,
      {
        providerRef: outcome.providerRef,
        transactionRef: outcome.transactionRef,
        providerStatus: outcome.providerStatus,
        providerPayload: outcome.providerPayload,
      } as any,
    );
    const withdrawal = transition?.withdrawal || created;
    this.recordWithdrawalAudit(
      actor,
      withdrawal,
      amount,
      dto.phone,
      idempotencyKey,
      nextStatus,
    );
    return {
      withdrawal,
      debit,
      balance: transition?.balance ?? balanceAfter,
      execution: { withdrawal, balance: transition?.balance ?? balanceAfter },
    };
  }

  private recordWithdrawalAudit(
    actor: any,
    withdrawal: any,
    amount: number,
    phone: string,
    idempotencyKey: string,
    status: string,
  ) {
    this.auditLogs.record({
      actorId: actor?.sub,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action: 'withdrawal.create',
      resourceType: 'withdrawal',
      resourceId: String(withdrawal?._id),
      metadata: { amount, phone, status, idempotencyKey },
      method: 'POST',
      path: '/balances/withdrawals',
      statusCode: status === 'failed' ? 400 : 200,
    });
  }

  /**
   * Clé déterministe pour les clients qui n'en fournissent pas : deux
   * requêtes identiques dans la même minute produisent la même clé, donc
   * l'index unique empêche un double retrait même en concurrence.
   */
  private autoIdempotencyKey(actorId: Types.ObjectId, amount: number, phone: string) {
    const minute = Math.floor(Date.now() / 60_000);
    const digest = createHash('sha256')
      .update(`${String(actorId)}|${amount}|${phone}|${minute}`)
      .digest('hex');
    return `svc:${digest}`;
  }

  private async replayWithdrawal(withdrawal: any, reason: string) {
    if (['failed', 'rejected'].includes(withdrawal.status)) {
      throw new BadRequestException(withdrawal.note || 'Withdrawal failed');
    }
    const balance = await this.balanceFor(this.scopeForWithdrawal(withdrawal));
    return {
      withdrawal,
      debit: null,
      balance,
      execution: { withdrawal, balance },
      idempotentReplay: true,
      replayReason: reason,
    };
  }

  /**
   * Encapsule l'appel à DigiKuntz `initiatePayout` et catégorise le résultat
   * pour le consommateur (createWithdrawal + cron de retry) :
   *   - `success` : transaction acceptée par DigiKuntz
   *   - `gateway_unavailable` : timeout/5xx/réseau — à retenter
   *   - `provider_error` : 4xx — le provider a refusé (insufficient balance,
   *     payload invalide…)
   */
  private async callDigikuntzPayoutOutcome(input: {
    amount: number;
    phone: string;
    accountBankCode: 'MTN' | 'ORANGEMONEY';
    receiverName: string;
    narration: string;
    idempotencyKey?: string;
  }): Promise<
    | {
        kind: 'success';
        providerRef?: string;
        transactionRef?: string;
        providerStatus?: string;
        providerPayload?: any;
      }
    | { kind: 'gateway_unavailable'; rawError: string }
    | { kind: 'idempotency_in_progress'; rawError: string }
    | { kind: 'provider_error'; providerMessage: string; rawError: string }
  > {
    try {
      const response = await this.digikuntzProvider.initiatePayout({
        amount: input.amount,
        phone: this.normalizeWithdrawalPhone(input.phone),
        accountBankCode: input.accountBankCode,
        receiverName: input.receiverName,
        narration: input.narration,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        kind: 'success',
        providerRef: response.providerRef,
        transactionRef: response.transactionRef,
        providerStatus: response.status,
        providerPayload: response.raw,
      };
    } catch (error: any) {
      const rawError = String(error?.message || error || '');
      // 409 d'idempotence : la requête initiale est encore en cours. Ne jamais
      // la traiter comme un refus (refund) ni créer un nouveau payout.
      if (error instanceof DigikuntzIdempotencyInProgressError) {
        return { kind: 'idempotency_in_progress', rawError };
      }
      if (error instanceof ServiceUnavailableException) {
        return { kind: 'gateway_unavailable', rawError };
      }
      const providerMessage = this.extractProviderErrorMessage(rawError);
      return { kind: 'provider_error', providerMessage, rawError };
    }
  }

  /**
   * Tente d'initier une withdrawal déjà persistée (cron de retry des
   * `gateway_unavailable`). La création initiale persiste le retrait et le
   * débit AVANT d'appeler DigiKuntz ; cette méthode réutilise le même ID
   * comme clé d'idempotence provider.
   */
  private async executeWithdrawal(withdrawalId: Types.ObjectId, actor: any) {
    const withdrawal = await this.withdrawalModel.findById(withdrawalId);
    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    const requester = await this.userModel.findById(withdrawal.requestedBy);

    const outcome = await this.callDigikuntzPayoutOutcome({
      amount: withdrawal.amount,
      phone: withdrawal.phone,
      accountBankCode: withdrawal.accountBankCode
        || detectCameroonMobileMoneyOperator(withdrawal.phone)
        || 'MTN',
      receiverName: this.userDisplayName(requester),
      narration: `Retrait Eat App ${withdrawal._id}`,
      idempotencyKey: String(withdrawal._id),
    });

    if (outcome.kind === 'idempotency_in_progress') {
      const now = new Date();
      return this.transitionWithdrawalStatus(
        String(withdrawal._id),
        'gateway_unavailable',
        undefined,
        actor?.sub,
        {
          providerStatus: 'idempotency_in_progress',
          providerPayload: {
            reason: 'idempotency_in_progress',
            error: outcome.rawError,
            attemptedAt: now.toISOString(),
          },
          ...(withdrawal.gatewayUnavailableSince
            ? {}
            : { gatewayUnavailableSince: now }),
          lastGatewayRetryAt: now,
          nextGatewayRetryAt: new Date(now.getTime() + 15 * 60 * 1000),
          gatewayUnavailableAttempts: (withdrawal.gatewayUnavailableAttempts || 0) + 1,
        } as any,
      );
    }

    if (outcome.kind === 'gateway_unavailable') {
      const now = new Date();
      return this.transitionWithdrawalStatus(
        String(withdrawal._id),
        'gateway_unavailable',
        undefined,
        actor?.sub,
        {
          providerStatus: 'gateway_unavailable',
          providerPayload: {
            reason: 'gateway_unavailable',
            error: outcome.rawError,
            attemptedAt: now.toISOString(),
          },
          ...(withdrawal.gatewayUnavailableSince
            ? {}
            : { gatewayUnavailableSince: now }),
          lastGatewayRetryAt: now,
          nextGatewayRetryAt: new Date(now.getTime() + this.minGatewayRetryIntervalMs),
          gatewayUnavailableAttempts: (withdrawal.gatewayUnavailableAttempts || 0) + 1,
        } as any,
      );
    }

    if (outcome.kind === 'provider_error') {
      this.logger.warn(
        `Withdrawal ${withdrawal._id} retry rejected by provider — providerMessage="${outcome.providerMessage}", raw="${outcome.rawError}"`,
      );
      return this.transitionWithdrawalStatus(
        String(withdrawal._id),
        'failed',
        undefined,
        actor?.sub,
        {
          providerStatus: 'payout_error',
          providerPayload: {
            error: outcome.rawError,
            providerMessage: outcome.providerMessage,
          },
        },
      );
    }

    if (!outcome.providerRef && !outcome.transactionRef) {
      return this.transitionWithdrawalStatus(
        String(withdrawal._id),
        'gateway_unavailable',
        undefined,
        actor?.sub,
        {
          providerStatus: 'missing_provider_reference',
          providerPayload: {
            reason: 'missing_provider_reference',
            providerStatus: outcome.providerStatus,
            providerPayload: outcome.providerPayload,
            attemptedAt: new Date().toISOString(),
          },
          lastGatewayRetryAt: new Date(),
          gatewayUnavailableAttempts: (withdrawal.gatewayUnavailableAttempts || 0) + 1,
        } as any,
      );
    }

    // Success — bascule en `pending` (en attente d'un état final DigiKuntz).
    const nextStatus = this.localStatusForProviderStatus(outcome.providerStatus) || 'pending';
    return this.transitionWithdrawalStatus(
      String(withdrawal._id),
      nextStatus,
      undefined,
      actor?.sub,
      {
        providerRef: outcome.providerRef,
        transactionRef: outcome.transactionRef,
        providerStatus: outcome.providerStatus,
        providerPayload: outcome.providerPayload,
      },
    );
  }

  private async transitionWithdrawalStatus(
    withdrawalId: string,
    nextStatus: WithdrawalStatus,
    note?: string,
    processedBy?: string,
    providerFields?: Partial<WithdrawalRequest>,
    options?: { notify?: boolean },
  ) {
    const session = await this.connection.startSession();
    // Alerte différée APRÈS commit : une transaction réessayée ou annulée ne
    // doit jamais envoyer de notification en double (ou pour un travail non
    // committé).
    let lateSuccessAlert: WithdrawalRequestDocument | null = null;
    try {
      let result: any;
      await session.withTransaction(async () => {
        const withdrawal = await this.withdrawalModel.findById(withdrawalId).session(session);
        if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
        if (withdrawal.status === nextStatus) {
          Object.assign(withdrawal, providerFields || {});
          if (note) withdrawal.note = note;
          await withdrawal.save({ session });
          const scope = this.scopeForWithdrawal(withdrawal);
          result = { withdrawal, refunded: false, balance: await this.refreshCachedBalance(scope, session) };
          return;
        }
        if (['paid', 'rejected', 'failed'].includes(withdrawal.status)) {
          // Succès provider tardif après un échec/refus déjà remboursé :
          // on ne bascule pas automatiquement (cela ferait payout + refund
          // sans débit compensatoire). On trace pour réconciliation manuelle.
          if (
            ['failed', 'rejected'].includes(withdrawal.status) &&
            ['pending', 'paid'].includes(nextStatus)
          ) {
            this.logger.error(
              `Late provider success for ${withdrawal.status} withdrawal ${withdrawal._id} — manual reconciliation required`,
            );
            const firstLateSuccess = !withdrawal.lateProviderSuccessAt;
            withdrawal.lateProviderSuccessAt = new Date();
            Object.assign(withdrawal, providerFields || {});
            await withdrawal.save({ session });
            if (firstLateSuccess) lateSuccessAlert = withdrawal;
            const scope = this.scopeForWithdrawal(withdrawal);
            result = {
              withdrawal,
              refunded: false,
              lateSuccess: true,
              balance: await this.refreshCachedBalance(scope, session),
            };
            return;
          }
          // Un payout déjà payé ne redevient jamais pending/failed.
          if (withdrawal.status === 'paid' && ['pending', 'failed'].includes(nextStatus)) {
            this.logger.warn(
              `Ignoring ${nextStatus} transition for already paid withdrawal ${withdrawal._id}`,
            );
            const scope = this.scopeForWithdrawal(withdrawal);
            result = {
              withdrawal,
              refunded: false,
              ignored: true,
              balance: await this.refreshCachedBalance(scope, session),
            };
            return;
          }
          throw new BadRequestException(`Withdrawal is already ${withdrawal.status}`);
        }

        withdrawal.status = nextStatus;
        withdrawal.note = note || withdrawal.note;
        if (processedBy) withdrawal.processedBy = this.oid(processedBy);
        withdrawal.processedAt = new Date();
        Object.assign(withdrawal, providerFields || {});
        // Nettoyage des champs de retry quand on quitte l'état
        // `gateway_unavailable` (sauf si la transition reste sur ce statut —
        // dans ce cas providerFields aura déjà repositionné les bons champs).
        if (nextStatus !== 'gateway_unavailable') {
          withdrawal.gatewayUnavailableSince = null;
          withdrawal.nextGatewayRetryAt = null;
          // On garde `gatewayUnavailableAttempts` pour traçabilité.
        }
        await withdrawal.save({ session });

        const shouldRefund = ['rejected', 'failed'].includes(nextStatus);
        let refunded = false;
        if (shouldRefund) {
          const refund = await this.upsertBalanceTransaction(
            { withdrawalId: withdrawal._id, reason: 'withdrawal_refund' },
            {
              ownerType: withdrawal.ownerType,
              restaurantId: withdrawal.restaurantId,
              userId: withdrawal.userId,
              withdrawalId: withdrawal._id,
              amount: withdrawal.amount,
              type: 'credit',
              reason: 'withdrawal_refund',
              currency: withdrawal.currency || 'XAF',
              note: note || `Remboursement retrait ${nextStatus}`,
              createdBy: processedBy ? this.oid(processedBy) : undefined,
            },
            session,
          );
          refunded = Boolean(refund.inserted);
        }

        const scope = this.scopeForWithdrawal(withdrawal);
        result = {
          withdrawal,
          refunded,
          balance: await this.refreshCachedBalance(scope, session),
        };
      });
      if (lateSuccessAlert) {
        void this.notifyWithdrawalReconciliationRequired(
          lateSuccessAlert,
          'late_provider_success',
        );
      }

      if (
        result?.withdrawal &&
        nextStatus === 'failed' &&
        options?.notify !== false &&
        // Une seule notification : seulement quand ce passage a réellement
        // inséré le remboursement (pas sur un rejeu failed → failed).
        result?.refunded
      ) {
        void this.notifyWithdrawalFailure(result.withdrawal as WithdrawalRequestDocument, note);
      }
      return result;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Notifie le demandeur (email + WhatsApp) et tous les admins Eat actifs
   * lorsqu'un retrait passe à `failed`. Le solde a déjà été remboursé par
   * `transitionWithdrawalStatus`. Fire-and-forget : aucune erreur ne bloque.
   */
  private async notifyWithdrawalFailure(
    withdrawal: WithdrawalRequestDocument,
    providerStatus?: string,
  ): Promise<void> {
    try {
      const [requester, restaurant, admins] = await Promise.all([
        withdrawal.requestedBy
          ? this.userModel
              .findById(withdrawal.requestedBy)
              .select({ email: 1, phone: 1, firstName: 1 })
              .lean()
          : null,
        withdrawal.restaurantId
          ? this.restaurantModel
              .findById(withdrawal.restaurantId)
              .select({ name: 1 })
              .lean()
          : null,
        this.userModel
          .find({ role: UserRole.ADMIN, isActive: true })
          .select({ email: 1, phone: 1 })
          .lean(),
      ]);

      const amount = Number(withdrawal.amount || 0);
      const currency = withdrawal.currency || 'XAF';
      const phone = withdrawal.phone;
      const withdrawalId = String(withdrawal._id);
      const ownerLabel =
        withdrawal.ownerType === 'restaurant'
          ? restaurant?.name || 'Restaurant'
          : `${requester?.firstName || ''} ${requester?.email || ''}`.trim() || 'Demandeur';

      await this.notifications.sendWithdrawalFailed(
        requester
          ? {
              email: requester.email,
              phone: requester.phone,
              firstName: requester.firstName,
            }
          : null,
        { amount, currency, phone, withdrawalId },
      );

      await this.notifications.sendWithdrawalFailedAdmins(
        (admins || []).map((admin) => ({ email: admin.email, phone: admin.phone })),
        {
          amount,
          currency,
          phone,
          ownerType: withdrawal.ownerType,
          ownerLabel,
          withdrawalId,
          providerStatus,
        },
      );
    } catch (error: any) {
      this.logger.warn(
        `notifyWithdrawalFailure(${String(withdrawal._id)}) failed: ${error?.message || error}`,
      );
    }
  }

  /**
   * Alerte admin : un retrait doit être vérifié manuellement (fonds conservés,
   * solde non recrédité). Fire-and-forget ; le caractère « une seule fois »
   * est garanti par l'état du retrait (appelé après commit).
   */
  private async notifyWithdrawalReconciliationRequired(
    withdrawal: WithdrawalRequestDocument,
    reason: string,
  ): Promise<void> {
    try {
      const [requester, restaurant, admins] = await Promise.all([
        withdrawal.requestedBy
          ? this.userModel
              .findById(withdrawal.requestedBy)
              .select({ email: 1, phone: 1, firstName: 1 })
              .lean()
          : null,
        withdrawal.restaurantId
          ? this.restaurantModel
              .findById(withdrawal.restaurantId)
              .select({ name: 1 })
              .lean()
          : null,
        this.userModel
          .find({ role: UserRole.ADMIN, isActive: true })
          .select({ email: 1, phone: 1 })
          .lean(),
      ]);

      const ownerLabel =
        withdrawal.ownerType === 'restaurant'
          ? restaurant?.name || 'Restaurant'
          : `${requester?.firstName || ''} ${requester?.email || ''}`.trim() || 'Demandeur';

      await this.notifications.sendWithdrawalReconciliationRequiredAdmins(
        (admins || []).map((admin) => ({ email: admin.email, phone: admin.phone })),
        {
          amount: Number(withdrawal.amount || 0),
          currency: withdrawal.currency || 'XAF',
          phone: withdrawal.phone,
          ownerType: withdrawal.ownerType,
          ownerLabel,
          withdrawalId: String(withdrawal._id),
          providerStatus: reason,
          errorDetail: withdrawal.providerStatus
            ? `providerStatus=${withdrawal.providerStatus}`
            : undefined,
        },
      );
    } catch (error: any) {
      this.logger.warn(
        `notifyWithdrawalReconciliationRequired(${String(withdrawal._id)}) failed: ${error?.message || error}`,
      );
    }
  }

  async updateWithdrawalStatus(withdrawalId: string, dto: UpdateWithdrawalStatusDto, actor: any) {
    this.assertAdmin(actor);
    const prev = await this.withdrawalModel.findById(withdrawalId).select('status');
    const result: any = await this.transitionWithdrawalStatus(
      withdrawalId,
      dto.status as WithdrawalStatus,
      dto.note,
      actor.sub,
    );

    const applied = !result?.ignored && !result?.lateSuccess;
    const effectiveStatus = result?.withdrawal?.status || dto.status;
    this.auditLogs.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'withdrawal.update_status',
      resourceType: 'withdrawal',
      resourceId: withdrawalId,
      metadata: {
        from: prev?.status,
        requested: dto.status,
        effective: effectiveStatus,
        applied,
        lateSuccess: Boolean(result?.lateSuccess),
        note: dto.note,
      },
      method: 'PATCH',
      path: `/balances/withdrawals/${withdrawalId}/status`,
      statusCode: applied ? 200 : 409,
    });

    if (!applied) {
      throw new ConflictException(
        `Withdrawal is already ${effectiveStatus}; transition not applied`,
      );
    }
    return result;
  }

  async processDigikuntzWithdrawalWebhook(withdrawalId: string, payload: any, providedToken?: string) {
    this.assertWithdrawalWebhookAuthenticated(providedToken);

    const providerStatus = payload?.status || payload?.data?.status;
    if (!providerStatus) throw new BadRequestException('Missing provider status');

    const nextStatus = this.localStatusForProviderStatus(providerStatus);
    if (!nextStatus) throw new BadRequestException(`Unsupported payout status: ${providerStatus}`);
    return this.transitionWithdrawalStatus(
      withdrawalId,
      nextStatus,
      undefined,
      undefined,
      {
        providerRef: payload?.id,
        transactionRef: payload?.data?.transactionRef,
        providerStatus,
        providerPayload: payload,
      },
    );
  }

  // Sync toutes les 10 secondes : on parcourt les retraits Eat encore en
  // `pending` (ou hérités en `approved`) et on interroge DigiKuntz via
  // `getTransactionStatus(providerRef)`. Tout changement d'état détecté
  // déclenche `transitionWithdrawalStatus` (refund + notifs si échec, mise
  // à `paid` si succès). Idempotent grâce au verrou
  // `isSyncingProviderWithdrawals`.
  @Cron(CronExpression.EVERY_10_SECONDS)
  async syncOpenDigikuntzWithdrawals() {
    // Multi-instance safe : lease 9s (< 10s interval) → un seul nœud poll
    // DigiKuntz par tick. L'idempotence des transitions garantit la cohérence
    // même si deux nœuds se chevauchent brièvement.
    if (!(await this.cronLease.acquire('balances.syncWithdrawals', 9 * 1000))) return;
    if (this.isSyncingProviderWithdrawals) {
      this.logger.debug('DigiKuntz withdrawal sync already running, skipping');
      return;
    }

    this.isSyncingProviderWithdrawals = true;
    try {
      const limit = Number(process.env.DIGIKUNTZ_SYNC_BATCH_LIMIT || 100);
      const withdrawals = await this.withdrawalModel
        .find({
          provider: 'digikuntz',
          // `pending` couvre le nouveau flux (initiation → attente final).
          // `approved` reste inclus pour les anciens retraits déjà transitionnés
          // avant le changement de comportement.
          status: { $in: ['pending', 'approved'] },
          // `transactionRef` est la référence stable côté DigiKuntz (ex:
          // IN958#260617135017) ; on préfère poll par cette ref plutôt que
          // par le `providerRef` (= Mongo _id) qui est moins lisible et
          // peut différer entre déploiements.
          $or: [
            { transactionRef: { $exists: true, $ne: null } },
            { providerRef: { $exists: true, $ne: null } },
          ],
        })
        .sort({ updatedAt: 1 })
        .limit(Number.isFinite(limit) && limit > 0 ? limit : 100);

      for (const withdrawal of withdrawals) {
        try {
          // Lookup par transactionRef puis providerRef, avec repli sur la route
          // documentée des payouts si nécessaire.
          const remote = await this.fetchProviderWithdrawalStatus(withdrawal);
          const providerStatus = remote?.status;
          const nextStatus = this.localStatusForProviderStatus(providerStatus);
          if (!remote || !providerStatus || !nextStatus) continue;

          await this.transitionWithdrawalStatus(
            String(withdrawal._id),
            nextStatus,
            undefined,
            undefined,
            {
              providerRef: remote.id || withdrawal.providerRef,
              transactionRef: remote.data?.transactionRef || withdrawal.transactionRef,
              providerStatus,
              providerPayload: remote,
            },
          );
        } catch (err: any) {
          this.logger.warn(`Failed to sync DigiKuntz withdrawal ${withdrawal._id}: ${err?.message || err}`);
        }
      }
    } finally {
      this.isSyncingProviderWithdrawals = false;
    }
  }

  /**
   * Cron qui repêche les retraits bloqués en `gateway_unavailable` :
   * - Si la fenêtre d'1 h depuis `gatewayUnavailableSince` est dépassée →
   *   bascule à `failed` (refund automatique + notifs user/admins).
   * - Sinon, tente de ré-initier l'appel à DigiKuntz via `executeWithdrawal`.
   *   Cette méthode gère elle-même tous les états cibles (pending/paid/failed)
   *   ou ré-incrémente `gatewayUnavailableAttempts` si le gateway est encore
   *   injoignable.
   *
   * Idempotent grâce au verrou `isRetryingGatewayWithdrawals`.
   */
  private async fetchProviderWithdrawalStatus(withdrawal: WithdrawalRequestDocument) {
    try {
      let remote: { id: string; status: string; data: any } | null = null;

      if (withdrawal.transactionRef) {
        remote = await this.digikuntzProvider.getTransactionStatusByRef(
          withdrawal.transactionRef,
        );
      }
      if (!remote && withdrawal.providerRef) {
        remote = await this.digikuntzProvider.getTransactionStatus(withdrawal.providerRef);
      }
      // Route documentée des payouts (fallback si les routes de statut de
      // transaction ne couvrent pas les retraits).
      if (!remote && (withdrawal.providerRef || withdrawal.transactionRef)) {
        remote = await this.digikuntzProvider.getPayoutStatus({
          providerRef: withdrawal.providerRef,
          transactionRef: withdrawal.transactionRef,
        });
      }

      return remote;
    } catch (error: any) {
      this.logger.warn(
        `Unable to fetch provider status for withdrawal ${withdrawal._id}: ${error?.message || error}`,
      );
      return null;
    }
  }

  private isRetryingGatewayWithdrawals = false;
  private readonly gatewayUnavailableTimeoutMs = envDuration(
    'DIGIKUNTZ_GATEWAY_TIMEOUT_MS',
    60 * 60 * 1000,
  );
  private readonly minGatewayRetryIntervalMs = envDuration(
    'DIGIKUNTZ_RETRY_INTERVAL_MS',
    60 * 1000,
  );
  // La TTL d'idempotence provider est de 24 h. On s'arrête avec une marge de
  // sécurité (23 h par défaut, plafond 23 h) : re-tenter à/au-delà de la TTL
  // réelle pourrait créer un second payout.
  private readonly idempotencyTtlMs = Math.min(
    envDuration('DIGIKUNTZ_IDEMPOTENCY_TTL_MS', 23 * 60 * 60 * 1000),
    23 * 60 * 60 * 1000,
  );

  @Cron(CronExpression.EVERY_MINUTE)
  async retryGatewayUnavailableWithdrawals() {
    // Multi-instance safe : lease 50s (< 60s interval).
    if (!(await this.cronLease.acquire('balances.retryGatewayUnavailable', 50 * 1000))) return;
    if (this.isRetryingGatewayWithdrawals) {
      this.logger.debug('Gateway-unavailable retry already running, skipping');
      return;
    }
    this.isRetryingGatewayWithdrawals = true;
    try {
      const now = new Date();
      const candidates = await this.withdrawalModel
        .find({
          status: 'gateway_unavailable',
          // Ne jamais laisser les lignes définitivement bloquées occuper le
          // lot : elles seraient les plus anciennes et affameraient le cron.
          providerStatus: { $nin: ['manual_reconciliation_required'] },
          // Respecte le backoff sans re-scanner les lignes trop récentes.
          $or: [
            { nextGatewayRetryAt: null },
            { nextGatewayRetryAt: { $lte: now } },
          ],
        })
        .sort({ nextGatewayRetryAt: 1, gatewayUnavailableSince: 1 })
        .limit(50);

      for (const withdrawal of candidates) {
        try {
          // Déjà sorti de la boucle automatique (TTL d'idempotence dépassée).
          if (withdrawal.providerStatus === 'manual_reconciliation_required') continue;

          const sinceDate =
            withdrawal.gatewayUnavailableSince ||
            withdrawal.lastGatewayRetryAt ||
            (withdrawal as any).updatedAt ||
            new Date();
          const since = new Date(sinceDate).getTime();
          const elapsed = Date.now() - since;

          // Évite de rappeler le provider tant que la tentative précédente
          // est trop récente (création initiale ou retry précédent).
          if (
            withdrawal.nextGatewayRetryAt &&
            Date.now() < new Date(withdrawal.nextGatewayRetryAt).getTime()
          ) {
            continue;
          }
          const lastAttempt = withdrawal.lastGatewayRetryAt
            ? new Date(withdrawal.lastGatewayRetryAt).getTime()
            : 0;
          if (Date.now() - lastAttempt < this.minGatewayRetryIntervalMs) continue;

          if (elapsed >= this.idempotencyTtlMs) {
            // Dernière lecture (sans effet de bord) avant d'abandonner : un
            // payout finalement accepté doit être résolu, pas poussé en
            // réconciliation manuelle.
            const remote = await this.fetchProviderWithdrawalStatus(withdrawal);
            const remoteStatus = this.localStatusForProviderStatus(remote?.status);
            if (remote && remoteStatus) {
              await this.transitionWithdrawalStatus(
                String(withdrawal._id),
                remoteStatus,
                undefined,
                undefined,
                {
                  providerRef: remote.id || withdrawal.providerRef,
                  transactionRef: remote.data?.transactionRef || withdrawal.transactionRef,
                  providerStatus: remote.status,
                  providerPayload: remote,
                } as any,
              );
              this.logger.warn(
                `Withdrawal ${withdrawal._id} exceeded the idempotency TTL but provider reports ${remote.status} — resolved as ${remoteStatus}`,
              );
              continue;
            }

            await this.transitionWithdrawalStatus(
              String(withdrawal._id),
              'gateway_unavailable',
              undefined,
              undefined,
              {
                providerStatus: 'manual_reconciliation_required',
                providerPayload: {
                  reason: 'idempotency_ttl_expired',
                  unavailableSince: withdrawal.gatewayUnavailableSince,
                  attempts: withdrawal.gatewayUnavailableAttempts || 0,
                },
                nextGatewayRetryAt: null,
              } as any,
            );
            this.logger.error(
              `Withdrawal ${withdrawal._id} exceeded the provider idempotency TTL (${Math.round(elapsed / 3_600_000)} h) — automatic retries stopped, manual reconciliation required`,
            );
            void this.notifyWithdrawalReconciliationRequired(
              withdrawal,
              'idempotency_ttl_expired',
            );
            continue;
          }

          if (elapsed >= this.gatewayUnavailableTimeoutMs) {
            // Avant de déclarer l'échec, on demande une dernière fois l'état
            // au provider. Un payout accepté mais dont la réponse a été perdue
            // ne doit pas être remboursé puis payé (double sortie d'argent).
            const remote = await this.fetchProviderWithdrawalStatus(withdrawal);
            const remoteStatus = this.localStatusForProviderStatus(remote?.status);
            if (remote && remoteStatus) {
              await this.transitionWithdrawalStatus(
                String(withdrawal._id),
                remoteStatus,
                undefined,
                undefined,
                {
                  providerRef: remote.id || withdrawal.providerRef,
                  transactionRef: remote.data?.transactionRef || withdrawal.transactionRef,
                  providerStatus: remote.status,
                  providerPayload: remote,
                } as any,
              );
              this.logger.warn(
                `Withdrawal ${withdrawal._id} timed out but provider reports ${remote.status} — resolved as ${remoteStatus}`,
              );
              continue;
            }

            // Provider injoignable ou sans référence exploitable : on ne
            // rembourse JAMAIS à l'aveugle. Un payout a pu être accepté alors
            // que la réponse a été perdue ; le remboursement créerait une
            // double sortie d'argent. Les fonds restent retenus et le retrait
            // reste en `gateway_unavailable` pour réconciliation manuelle.
            await this.transitionWithdrawalStatus(
              String(withdrawal._id),
              'gateway_unavailable',
              undefined,
              undefined,
              {
                providerStatus: 'unverified_timeout',
                providerPayload: {
                  reason: 'unverified_timeout',
                  unavailableSince: withdrawal.gatewayUnavailableSince,
                  attempts: withdrawal.gatewayUnavailableAttempts || 0,
                  lastCheckedAt: new Date().toISOString(),
                },
                lastGatewayRetryAt: new Date(),
                // Backoff : on ne re-sonde pas le provider toutes les minutes
                // indéfiniment quand il ne peut rien confirmer.
                nextGatewayRetryAt: new Date(Date.now() + 15 * 60 * 1000),
              } as any,
            );
            this.logger.error(
              `Withdrawal ${withdrawal._id} timed out after ${Math.round(elapsed / 60_000)} min without provider confirmation — funds held, manual reconciliation required`,
            );
            // Une seule alerte par retrait (pas à chaque backoff).
            if (withdrawal.providerStatus !== 'unverified_timeout') {
              void this.notifyWithdrawalReconciliationRequired(
                withdrawal,
                'unverified_timeout',
              );
            }
            continue;
          }

          // Sinon, on retente l'initiation. `executeWithdrawal` gère lui-même
          // toutes les transitions cibles (succès, échec, gateway encore
          // indisponible).
          await this.executeWithdrawal(
            withdrawal._id as Types.ObjectId,
            { sub: withdrawal.requestedBy ? String(withdrawal.requestedBy) : undefined },
          );
        } catch (err: any) {
          this.logger.warn(
            `Gateway retry failed for withdrawal ${withdrawal._id}: ${err?.message || err}`,
          );
        }
      }
    } finally {
      this.isRetryingGatewayWithdrawals = false;
    }
  }
}
