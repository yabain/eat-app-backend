import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BalanceTransaction, BalanceTransactionDocument } from '../../database/schemas/balance-transaction.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { WithdrawalRequest, WithdrawalRequestDocument } from '../../database/schemas/withdrawal-request.schema';
import { UserRole } from '../../common/enums/roles.enum';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { AdminBalanceOperationDto } from './dto/admin-balance-operation.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

@Injectable()
export class BalancesService {
  constructor(
    @InjectModel(BalanceTransaction.name) private balanceModel: Model<BalanceTransactionDocument>,
    @InjectModel(WithdrawalRequest.name) private withdrawalModel: Model<WithdrawalRequestDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
  ) {}

  private oid(id: string | Types.ObjectId) { return new Types.ObjectId(String(id)); }

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
