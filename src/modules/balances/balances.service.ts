import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BalanceTransaction, BalanceTransactionDocument } from '../../database/schemas/balance-transaction.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { WithdrawalRequest, WithdrawalRequestDocument } from '../../database/schemas/withdrawal-request.schema';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { UserRole } from '../../common/enums/roles.enum';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { CreditDriverDto } from './dto/credit-driver.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

@Injectable()
export class BalancesService {
  constructor(
    @InjectModel(BalanceTransaction.name) private balanceModel: Model<BalanceTransactionDocument>,
    @InjectModel(WithdrawalRequest.name) private withdrawalModel: Model<WithdrawalRequestDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
  ) {}

  private oid(id: string | Types.ObjectId) { return new Types.ObjectId(String(id)); }

  private async platformFeesTotal(): Promise<number> {
    const agg = await this.orderModel.aggregate([
      { $match: { paymentStatus: PaymentStatus.PAID } },
      { $group: { _id: null, total: { $sum: '$pricingSnapshot.platformFee' } } },
    ]);
    return Number(agg[0]?.total || 0);
  }

  private async balanceFor(filter: any): Promise<number> {
    const agg = await this.balanceModel.aggregate([
      { $match: filter },
      { $group: { _id: null, balance: { $sum: '$amount' } } },
    ]);
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
    const platformFees = scope.ownerType === 'system' ? await this.platformFeesTotal() : 0;
    return {
      ownerType: scope.ownerType,
      balance: scope.ownerType === 'system' ? platformFees + ledgerBalance : ledgerBalance,
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

  async creditDriver(driverId: string, dto: CreditDriverDto, actor: any) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Only admin can credit a driver');
    const amount = Number(dto.amount || 0);
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const driver = await this.userModel.findById(driverId);
    if (!driver) throw new NotFoundException('Driver not found');
    if (driver.role !== UserRole.DRIVER) throw new BadRequestException('Selected user is not a driver');

    const mainBalance = (await this.summary(actor)).balance;
    if (amount > mainBalance) throw new BadRequestException('Insufficient main balance');

    const createdBy = this.oid(actor.sub);
    const [systemDebit, driverCredit] = await Promise.all([
      this.balanceModel.create({ ownerType: 'system', amount: -amount, type: 'debit', reason: 'driver_funding', userId: driver._id, createdBy, note: dto.note, currency: 'XAF' }),
      this.balanceModel.create({ ownerType: 'user', userId: driver._id, amount, type: 'credit', reason: 'admin_driver_credit', createdBy, note: dto.note, currency: 'XAF' }),
    ]);

    return { systemDebit, driverCredit, driverBalance: await this.balanceFor({ ownerType: 'user', userId: driver._id }) };
  }

  async createWithdrawal(actor: any, dto: CreateWithdrawalDto) {
    const scope = this.scopeForActor(actor);
    if (scope.ownerType === 'system') throw new BadRequestException('System balance withdrawals are not available here');
    const amount = Number(dto.amount || 0);
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const available = (await this.summary(actor)).balance;
    if (amount > available) throw new BadRequestException('Insufficient balance');

    const withdrawal = await this.withdrawalModel.create({
      ...scope,
      requestedBy: this.oid(actor.sub),
      amount,
      phone: dto.phone,
      currency: 'XAF',
      status: 'pending',
    });

    const debit = await this.balanceModel.create({
      ...scope,
      withdrawalId: withdrawal._id,
      amount: -amount,
      type: 'debit',
      reason: 'withdrawal_request',
      currency: 'XAF',
      note: `Retrait MTN ${dto.phone}`,
      createdBy: this.oid(actor.sub),
    });

    return { withdrawal, debit, balance: (await this.summary(actor)).balance };
  }
}
