import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { timingSafeEqual } from 'crypto';
import { Balance, BalanceAccountType, BalanceDocument } from '../../database/schemas/balance.schema';
import { BalanceTransaction, BalanceTransactionDocument } from '../../database/schemas/balance-transaction.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { WithdrawalRequest, WithdrawalRequestDocument, WithdrawalStatus } from '../../database/schemas/withdrawal-request.schema';
import { Payment, PaymentDocument } from '../../database/schemas/payment.schema';
import { UserRole } from '../../common/enums/roles.enum';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { DigikuntzProvider } from '../payments/providers/digikuntz.provider';
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
  ) {}

  private oid(id: string | Types.ObjectId) { return new Types.ObjectId(String(id)); }

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
    const account = this.balanceAccountForScope(scope);
    let doc = await this.balanceModel.findOne(account).session(session || null);
    if (!doc) {
      const agg = await this.transactionModel.aggregate([
        { $match: scope },
        { $group: { _id: null, balance: { $sum: '$amount' } } },
      ]).session(session || null);
      const balance = this.toBalanceInteger(agg[0]?.balance || 0);
      doc = await this.balanceModel.findOneAndUpdate(
        account,
        { $setOnInsert: { ...account, balance, currency: 'XAF' } },
        { upsert: true, new: true, session },
      );
    }
    return this.toBalanceInteger(doc?.balance || 0);
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

  private async upsertBalanceTransaction(filter: any, payload: any, session?: ClientSession) {
    const previous = await this.transactionModel.findOne(filter).session(session || null).select('amount');
    const previousAmount = Number(previous?.amount || 0);
    const nextAmount = this.toBalanceInteger(payload.amount);
    payload.amount = nextAmount;
    const delta = nextAmount - previousAmount;
    const account = this.balanceAccountForScope(payload);
    const result = await this.transactionModel.updateOne(
      filter,
      { $setOnInsert: payload },
      { upsert: true, session },
    );
    if (delta !== 0) {
      await this.balanceModel.updateOne(
        account,
        {
          $setOnInsert: { ...account, currency: payload.currency || 'XAF' },
          $inc: { balance: delta },
        },
        { upsert: true, session },
      );
    }
    return result;
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
    if (this.isBackfillingBalances) return;
    this.isBackfillingBalances = true;
    try {
      const rows = await this.transactionModel.aggregate([
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

      for (const row of rows) {
        const scope = row._id.ownerType === 'restaurant'
          ? { ownerType: 'restaurant', restaurantId: row._id.restaurantId }
          : row._id.ownerType === 'user'
            ? { ownerType: 'user', userId: row._id.userId }
            : { ownerType: 'system' };
        const account = this.balanceAccountForScope(scope);
        await this.balanceModel.updateOne(
          account,
          {
            $set: {
              ...account,
              balance: this.toBalanceInteger(row.balance),
              currency: row.currency || 'XAF',
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
        label: 'Retrait de solde',
        amount: Number(withdrawal.amount || 0),
        currency: withdrawal.currency || 'XAF',
        status: withdrawal.status,
        provider: withdrawal.provider,
        providerRef: withdrawal.providerRef,
        transactionRef: withdrawal.transactionRef,
        phone: withdrawal.phone,
        accountBankCode: withdrawal.accountBankCode,
        note: withdrawal.note,
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

  private withdrawalCallbackUrl(withdrawalId: string) {
    const webhookSecret = process.env.DIGIKUNTZ_WEBHOOK_SECRET;
    const baseUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    if (!baseUrl) return undefined;
    const token = webhookSecret ? `?token=${encodeURIComponent(webhookSecret)}` : '';
    return `${baseUrl}/api/balances/withdrawals/${withdrawalId}/webhook/digikuntz${token}`;
  }

  private userDisplayName(user: any) {
    return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || user?.phone || 'Bénéficiaire';
  }

  private normalizeWithdrawalPhone(phone: string) {
    return `237${normalizeCameroonPhone(phone)}`;
  }

  private localStatusForProviderStatus(status?: string): WithdrawalStatus | null {
    if (status === 'payout_pending') return 'approved';
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

    const session = await this.connection.startSession();
    try {
      let result: any;
      let withdrawalId: Types.ObjectId | null = null;
      await session.withTransaction(async () => {
        const available = await this.balanceFor(scope, session);
        if (amount > available) throw new BadRequestException('Insufficient balance');

        const [withdrawal] = await this.withdrawalModel.create([{
          ...scope,
          requestedBy: this.oid(actor.sub),
          amount,
          phone: dto.phone,
          accountBankCode,
          currency: 'XAF',
          status: 'pending',
        }], { session });

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

        result = {
          withdrawal,
          debit,
          balance: await this.balanceFor(scope, session),
        };
        withdrawalId = withdrawal._id;
      });
      if (!withdrawalId) throw new BadRequestException('Withdrawal creation failed');
      const execution = await this.executeWithdrawal(withdrawalId, actor);
      return { ...result, withdrawal: execution.withdrawal, balance: execution.balance, execution };
    } finally {
      await session.endSession();
    }
  }

  private async executeWithdrawal(withdrawalId: Types.ObjectId, actor: any) {
    const withdrawal = await this.withdrawalModel.findById(withdrawalId);
    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    const requester = await this.userModel.findById(withdrawal.requestedBy);
    const response = await this.digikuntzProvider
      .initiatePayout({
        amount: withdrawal.amount,
        phone: this.normalizeWithdrawalPhone(withdrawal.phone),
        accountBankCode: withdrawal.accountBankCode
          || detectCameroonMobileMoneyOperator(withdrawal.phone)
          || 'MTN',
        receiverName: this.userDisplayName(requester),
        narration: `Retrait Eat App ${withdrawal._id}`,
        callbackUrl: this.withdrawalCallbackUrl(String(withdrawal._id)),
      })
      .catch((error) => ({
        providerRef: undefined,
        transactionRef: undefined,
        status: 'payout_error',
        raw: { error: error?.message || String(error) },
      }));

    const nextStatus = this.localStatusForProviderStatus(response.status) || 'approved';
    return this.transitionWithdrawalStatus(
      String(withdrawal._id),
      nextStatus,
      response.status,
      actor.sub,
      {
        providerRef: response.providerRef,
        transactionRef: response.transactionRef,
        providerStatus: response.status,
        providerPayload: response.raw,
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
          result = { withdrawal, refunded: false, balance: await this.balanceFor(scope, session) };
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
          refunded = Boolean(refund.upsertedCount);
        }

        const scope = this.scopeForWithdrawal(withdrawal);
        result = {
          withdrawal,
          refunded,
          balance: await this.balanceFor(scope, session),
        };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async updateWithdrawalStatus(withdrawalId: string, dto: UpdateWithdrawalStatusDto, actor: any) {
    this.assertAdmin(actor);
    return this.transitionWithdrawalStatus(withdrawalId, dto.status as WithdrawalStatus, dto.note, actor.sub);
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
      providerStatus,
      undefined,
      {
        providerRef: payload?.id,
        transactionRef: payload?.data?.transactionRef,
        providerStatus,
        providerPayload: payload,
      },
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async syncOpenDigikuntzWithdrawals() {
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
          status: { $in: ['approved'] },
          providerRef: { $exists: true, $ne: null },
        })
        .sort({ updatedAt: 1 })
        .limit(Number.isFinite(limit) && limit > 0 ? limit : 100);

      for (const withdrawal of withdrawals) {
        try {
          const remote = await this.digikuntzProvider.getTransactionStatus(withdrawal.providerRef || '');
          const providerStatus = remote?.status;
          const nextStatus = this.localStatusForProviderStatus(providerStatus);
          if (!remote || !providerStatus || !nextStatus) continue;

          await this.transitionWithdrawalStatus(
            String(withdrawal._id),
            nextStatus,
            providerStatus,
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
}
