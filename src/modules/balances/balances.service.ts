import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BalanceTransaction, BalanceTransactionDocument } from '../../database/schemas/balance-transaction.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { WithdrawalRequest, WithdrawalRequestDocument, WithdrawalStatus } from '../../database/schemas/withdrawal-request.schema';
import { UserRole } from '../../common/enums/roles.enum';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { DigikuntzProvider } from '../payments/providers/digikuntz.provider';
import { AdminBalanceOperationDto } from './dto/admin-balance-operation.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { UpdateWithdrawalStatusDto } from './dto/update-withdrawal-status.dto';

@Injectable()
export class BalancesService {
  private readonly logger = new Logger(BalancesService.name);
  private isSyncingProviderWithdrawals = false;

  constructor(
    @InjectModel(BalanceTransaction.name) private balanceModel: Model<BalanceTransactionDocument>,
    @InjectModel(WithdrawalRequest.name) private withdrawalModel: Model<WithdrawalRequestDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly digikuntzProvider: DigikuntzProvider,
  ) {}

  private oid(id: string | Types.ObjectId) { return new Types.ObjectId(String(id)); }

  private async balanceFor(filter: any, session?: ClientSession): Promise<number> {
    const agg = await this.balanceModel.aggregate([
      { $match: filter },
      { $group: { _id: null, balance: { $sum: '$amount' } } },
    ]).session(session || null);
    return Number(agg[0]?.balance || 0);
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

  async summary(actor: any) {
    const scope = this.scopeForActor(actor);
    const ledgerBalance = await this.balanceFor(scope);
    return {
      ownerType: scope.ownerType,
      balance: ledgerBalance,
      currency: 'XAF',
    };
  }

  async transactions(actor: any, page?: number, limit?: number) {
    const scope = this.scopeForActor(actor);
    const pagination = normalizePagination(page, limit);
    const [data, total] = await Promise.all([
      this.balanceModel.find(scope).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
      this.balanceModel.countDocuments(scope),
    ]);
    return { data, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
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
    const amount = Number(dto.amount || 0);
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    return amount;
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
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.startsWith('237') ? digits : `237${digits}`;
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
      userId: driver._id,
      balance: await this.balanceFor({ ownerType: 'user', userId: driver._id }),
      currency: 'XAF',
    };
  }

  async restaurantBalance(restaurantId: string, actor: any) {
    this.assertAdmin(actor);
    const restaurant = await this.findRestaurantOrFail(restaurantId);
    return {
      ownerType: 'restaurant',
      restaurantId: restaurant._id,
      balance: await this.balanceFor({ ownerType: 'restaurant', restaurantId: restaurant._id }),
      currency: 'XAF',
    };
  }

  async creditDriver(driverId: string, dto: AdminBalanceOperationDto, actor: any) {
    this.assertAdmin(actor);
    const amount = this.normalizeAmount(dto);
    const driver = await this.findDriverOrFail(driverId);

    const mainBalance = (await this.summary(actor)).balance;
    if (amount > mainBalance) throw new BadRequestException('Insufficient main balance');

    const createdBy = this.oid(actor.sub);
    const [systemDebit, driverCredit] = await Promise.all([
      this.balanceModel.create({ ownerType: 'system', amount: -amount, type: 'debit', reason: 'driver_funding', userId: driver._id, createdBy, note: dto.note, currency: 'XAF' }),
      this.balanceModel.create({ ownerType: 'user', userId: driver._id, amount, type: 'credit', reason: 'admin_driver_credit', createdBy, note: dto.note, currency: 'XAF' }),
    ]);

    return { systemDebit, driverCredit, driverBalance: await this.balanceFor({ ownerType: 'user', userId: driver._id }) };
  }

  async debitDriver(driverId: string, dto: AdminBalanceOperationDto, actor: any) {
    this.assertAdmin(actor);
    const amount = this.normalizeAmount(dto);
    const driver = await this.findDriverOrFail(driverId);
    const driverBalance = await this.balanceFor({ ownerType: 'user', userId: driver._id });
    if (amount > driverBalance) throw new BadRequestException('Insufficient driver balance');

    const createdBy = this.oid(actor.sub);
    const transaction = await this.balanceModel.create({
      ownerType: 'user',
      userId: driver._id,
      amount: -amount,
      type: 'debit',
      reason: 'admin_driver_debit',
      createdBy,
      note: dto.note,
      currency: 'XAF',
    });

    return { transaction, driverBalance: await this.balanceFor({ ownerType: 'user', userId: driver._id }) };
  }

  async creditRestaurant(restaurantId: string, dto: AdminBalanceOperationDto, actor: any) {
    this.assertAdmin(actor);
    const amount = this.normalizeAmount(dto);
    const restaurant = await this.findRestaurantOrFail(restaurantId);
    const mainBalance = (await this.summary(actor)).balance;
    if (amount > mainBalance) throw new BadRequestException('Insufficient main balance');

    const createdBy = this.oid(actor.sub);
    const [systemDebit, restaurantCredit] = await Promise.all([
      this.balanceModel.create({ ownerType: 'system', amount: -amount, type: 'debit', reason: 'restaurant_funding', restaurantId: restaurant._id, createdBy, note: dto.note, currency: 'XAF' }),
      this.balanceModel.create({ ownerType: 'restaurant', restaurantId: restaurant._id, amount, type: 'credit', reason: 'admin_restaurant_credit', createdBy, note: dto.note, currency: 'XAF' }),
    ]);

    return { systemDebit, restaurantCredit, restaurantBalance: await this.balanceFor({ ownerType: 'restaurant', restaurantId: restaurant._id }) };
  }

  async debitRestaurant(restaurantId: string, dto: AdminBalanceOperationDto, actor: any) {
    this.assertAdmin(actor);
    const amount = this.normalizeAmount(dto);
    const restaurant = await this.findRestaurantOrFail(restaurantId);
    const restaurantBalance = await this.balanceFor({ ownerType: 'restaurant', restaurantId: restaurant._id });
    if (amount > restaurantBalance) throw new BadRequestException('Insufficient restaurant balance');

    const createdBy = this.oid(actor.sub);
    const transaction = await this.balanceModel.create({
      ownerType: 'restaurant',
      restaurantId: restaurant._id,
      amount: -amount,
      type: 'debit',
      reason: 'admin_restaurant_debit',
      createdBy,
      note: dto.note,
      currency: 'XAF',
    });

    return { transaction, restaurantBalance: await this.balanceFor({ ownerType: 'restaurant', restaurantId: restaurant._id }) };
  }

  async createWithdrawal(actor: any, dto: CreateWithdrawalDto) {
    if (![UserRole.MANAGER, UserRole.DRIVER].includes(actor.role)) {
      throw new ForbiddenException('Only managers and drivers can request withdrawals');
    }
    const scope = this.scopeForActor(actor);
    if (scope.ownerType === 'system') throw new BadRequestException('System balance withdrawals are not available here');
    const amount = Number(dto.amount || 0);
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

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
          currency: 'XAF',
          status: 'pending',
        }], { session });

        const [debit] = await this.balanceModel.create([{
          ...scope,
          withdrawalId: withdrawal._id,
          amount: -amount,
          type: 'debit',
          reason: 'withdrawal_request',
          currency: 'XAF',
          note: `Retrait MTN ${dto.phone}`,
          createdBy: this.oid(actor.sub),
        }], { session });

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
          const scope = withdrawal.ownerType === 'restaurant'
            ? { ownerType: 'restaurant', restaurantId: withdrawal.restaurantId }
            : { ownerType: 'user', userId: withdrawal.userId };
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
          const refund = await this.balanceModel.updateOne(
            { withdrawalId: withdrawal._id, reason: 'withdrawal_refund' },
            {
              $setOnInsert: {
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
            },
            { upsert: true, session },
          );
          refunded = Boolean(refund.upsertedCount);
        }

        const scope = withdrawal.ownerType === 'restaurant'
          ? { ownerType: 'restaurant', restaurantId: withdrawal.restaurantId }
          : { ownerType: 'user', userId: withdrawal.userId };
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
    const expectedToken = process.env.DIGIKUNTZ_WEBHOOK_SECRET;
    if (expectedToken && providedToken !== expectedToken) {
      throw new ForbiddenException('Invalid webhook token');
    }

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
