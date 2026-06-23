import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { timingSafeEqual } from 'crypto';
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
import { DigikuntzProvider } from '../payments/providers/digikuntz.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminBalanceOperationDto } from './dto/admin-balance-operation.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { UpdateWithdrawalStatusDto } from './dto/update-withdrawal-status.dto';
import {
  detectCameroonMobileMoneyOperator,
  normalizeCameroonPhone,
} from '../../common/utils/cameroon-mobile-money.util';

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

  /**
   * Renvoie l'ensemble des scopes ayant une withdrawal NON soldée
   * (pending/gateway_unavailable/approved). Ces scopes ont leur solde « gelé »
   * — tout cron de réconciliation doit les skipper pour ne pas écraser le
   * débit/refund déjà appliqué par `$inc`.
   */
  async getScopesWithUnresolvedWithdrawals(): Promise<Set<string>> {
    const rows = await this.withdrawalModel.aggregate([
      { $match: { status: { $in: ['pending', 'gateway_unavailable', 'approved'] } } },
      {
        $group: {
          _id: {
            ownerType: '$ownerType',
            restaurantId: '$restaurantId',
            userId: '$userId',
          },
        },
      },
    ]);
    return new Set(rows.map((row: any) => this.scopeKey(row._id)));
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
        const key = this.scopeKey(row._id);
        map.set(key, {
          scope: row._id,
          balance: Number(row.balance || 0),
          currency: row.currency,
        });
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

    // Préchecking: solde suffisant côté Eat (hors transaction pour ne pas
    // tenir un lock pendant l'appel réseau à DigiKuntz).
    const preAvailable = await this.balanceFor(scope);
    if (amount > preAvailable) throw new BadRequestException('Insufficient balance');

    // 1) Contact DigiKuntz EN PREMIER. L'ID du retrait est généré upfront pour
    //    pouvoir le passer en narration sans avoir encore écrit en base.
    const withdrawalId = new Types.ObjectId();
    const requester = await this.userModel.findById(this.oid(actor.sub));
    const outcome = await this.callDigikuntzPayoutOutcome({
      amount,
      phone: dto.phone,
      accountBankCode,
      receiverName: this.userDisplayName(requester),
      narration: `Retrait Eat App ${withdrawalId}`,
    });

    // 2) Selon la réponse de DigiKuntz, on enregistre la transaction.
    //    - SUCCESS → status='pending' (en attente de l'état final DigiKuntz)
    //    - GATEWAY_UNAVAILABLE → status='gateway_unavailable' (le cron retentera)
    //    - PROVIDER_ERROR (4xx) → on lève une exception → AUCUNE écriture en BD
    if (outcome.kind === 'provider_error') {
      this.logger.warn(
        `Withdrawal aborted (no DB write) — providerMessage="${outcome.providerMessage}", raw="${outcome.rawError}"`,
      );
      throw new BadRequestException(
        outcome.providerMessage || 'Retrait refusé par le service de paiement.',
      );
    }

    const localStatus: WithdrawalStatus =
      outcome.kind === 'gateway_unavailable' ? 'gateway_unavailable' : 'pending';
    const now = new Date();

    const session = await this.connection.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        // Re-check de solde dans la transaction (race protection).
        const available = await this.balanceFor(scope, session);
        if (amount > available) throw new BadRequestException('Insufficient balance');

        const [withdrawal] = await this.withdrawalModel.create([{
          _id: withdrawalId,
          ...scope,
          requestedBy: this.oid(actor.sub),
          amount,
          phone: dto.phone,
          accountBankCode,
          currency: 'XAF',
          status: localStatus,
          provider: 'digikuntz',
          ...(outcome.kind === 'success'
            ? {
                providerRef: outcome.providerRef,
                transactionRef: outcome.transactionRef,
                providerStatus: outcome.providerStatus,
                providerPayload: outcome.providerPayload,
              }
            : {
                providerStatus: 'gateway_unavailable',
                providerPayload: {
                  reason: 'gateway_unavailable',
                  error: outcome.rawError,
                  attemptedAt: now.toISOString(),
                },
                gatewayUnavailableSince: now,
                gatewayUnavailableAttempts: 1,
                lastGatewayRetryAt: now,
              }),
        }], { session });

        // Débit initial : insertion directe via `recordBalanceTransaction`.
        // L'unique index (withdrawalId, reason) sur BalanceTransaction
        // prévient tout double-insert au niveau Mongo. La transaction
        // session garantit l'atomicité avec la création de la withdrawal.
        const debit = await this.recordBalanceTransaction({
          ...scope,
          withdrawalId: withdrawal._id,
          amount: -amount,
          type: 'debit',
          reason: 'withdrawal_request',
          currency: 'XAF',
          note: `Retrait ${accountBankCode === 'MTN' ? 'MTN Mobile Money' : 'Orange Money'} ${dto.phone}`,
          createdBy: this.oid(actor.sub),
        }, session);

        const newBalance = await this.refreshCachedBalance(scope, session);
        this.logger.log(
          `Withdrawal ${withdrawal._id} created — amount=${amount}, status=${localStatus}, balanceBefore=${available}, balanceAfter=${newBalance}, debitId=${(debit as any)?._id}`,
        );

        result = {
          withdrawal,
          debit,
          balance: newBalance,
        };
      });
      this.auditLogs.record({
        actorId: actor.sub,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'withdrawal.create',
        resourceType: 'withdrawal',
        resourceId: String(result.withdrawal._id),
        metadata: { amount, phone: dto.phone, status: localStatus },
        method: 'POST',
        path: '/balances/withdrawals',
        statusCode: 200,
      });
      return { ...result, execution: { withdrawal: result.withdrawal, balance: result.balance } };
    } finally {
      await session.endSession();
    }
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
  }): Promise<
    | {
        kind: 'success';
        providerRef?: string;
        transactionRef?: string;
        providerStatus?: string;
        providerPayload?: any;
      }
    | { kind: 'gateway_unavailable'; rawError: string }
    | { kind: 'provider_error'; providerMessage: string; rawError: string }
  > {
    try {
      const response = await this.digikuntzProvider.initiatePayout({
        amount: input.amount,
        phone: this.normalizeWithdrawalPhone(input.phone),
        accountBankCode: input.accountBankCode,
        receiverName: input.receiverName,
        narration: input.narration,
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
      if (error instanceof ServiceUnavailableException) {
        return { kind: 'gateway_unavailable', rawError };
      }
      const providerMessage = this.extractProviderErrorMessage(rawError);
      return { kind: 'provider_error', providerMessage, rawError };
    }
  }

  /**
   * Tente d'initier une withdrawal déjà existante chez DigiKuntz (utilisé
   * uniquement par le cron de retry des `gateway_unavailable`). À la création
   * initiale, on passe par `createWithdrawal` qui appelle DigiKuntz AVANT
   * d'écrire en base.
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
    });

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
  ) {
    const session = await this.connection.startSession();
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
      if (result?.withdrawal && nextStatus === 'failed') {
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

  async updateWithdrawalStatus(withdrawalId: string, dto: UpdateWithdrawalStatusDto, actor: any) {
    this.assertAdmin(actor);
    const prev = await this.withdrawalModel.findById(withdrawalId).select('status');
    const result = await this.transitionWithdrawalStatus(withdrawalId, dto.status as WithdrawalStatus, dto.note, actor.sub);
    this.auditLogs.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'withdrawal.update_status',
      resourceType: 'withdrawal',
      resourceId: withdrawalId,
      metadata: { from: prev?.status, to: dto.status, note: dto.note },
      method: 'PATCH',
      path: `/balances/withdrawals/${withdrawalId}/status`,
      statusCode: 200,
    });
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
          // Lookup prioritaire par transactionRef ; fallback sur providerRef
          // si la ref n'a pas pu être capturée à l'initiation.
          const remote = withdrawal.transactionRef
            ? await this.digikuntzProvider.getTransactionStatusByRef(withdrawal.transactionRef)
            : await this.digikuntzProvider.getTransactionStatus(withdrawal.providerRef || '');
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
  private isRetryingGatewayWithdrawals = false;
  private readonly gatewayUnavailableTimeoutMs = Number(
    process.env.DIGIKUNTZ_GATEWAY_TIMEOUT_MS || 60 * 60 * 1000,
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
      const candidates = await this.withdrawalModel
        .find({ status: 'gateway_unavailable' })
        .sort({ gatewayUnavailableSince: 1 })
        .limit(50);

      for (const withdrawal of candidates) {
        try {
          const since = withdrawal.gatewayUnavailableSince
            ? new Date(withdrawal.gatewayUnavailableSince).getTime()
            : Date.now();
          const elapsed = Date.now() - since;

          if (elapsed >= this.gatewayUnavailableTimeoutMs) {
            // Timeout d'1 h dépassé : on déclare le retrait en échec.
            // `transitionWithdrawalStatus` orchestre refund + notif user/admins.
            await this.transitionWithdrawalStatus(
              String(withdrawal._id),
              'failed',
              undefined,
              undefined,
              {
                providerStatus: 'gateway_timeout',
                providerPayload: {
                  reason: 'gateway_unavailable_timeout',
                  unavailableSince: withdrawal.gatewayUnavailableSince,
                  attempts: withdrawal.gatewayUnavailableAttempts || 0,
                },
              },
            );
            this.logger.warn(
              `Withdrawal ${withdrawal._id} timed out in gateway_unavailable after ${Math.round(elapsed / 60_000)} min — marked failed`,
            );
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
