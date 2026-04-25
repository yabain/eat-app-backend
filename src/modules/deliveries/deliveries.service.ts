import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Delivery, DeliveryDocument } from '../../database/schemas/delivery.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';
import { UserRole } from '../../common/enums/roles.enum';
import { AssignDeliveryDto } from './dto/assign-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

@Injectable()
export class DeliveriesService {
  constructor(
    @InjectModel(Delivery.name) private deliveryModel: Model<DeliveryDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async assign(dto: AssignDeliveryDto, actor: any) {
    const order = await this.orderModel.findById(dto.orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (actor.role === UserRole.MANAGER && String(order.restaurantId) !== String(actor.restaurantId)) {
      throw new ForbiddenException('You can only assign deliveries for your restaurant');
    }

    const driver = await this.userModel.findById(dto.driverId);
    if (!driver) throw new NotFoundException('Driver not found');
    if (driver.role !== UserRole.DRIVER) throw new BadRequestException('Assigned user must be a driver');
    if (actor.role === UserRole.MANAGER && String(driver.restaurantId || '') !== String(actor.restaurantId || '')) {
      throw new ForbiddenException('Manager can only assign drivers from their restaurant');
    }

    order.assignedDriverId = new Types.ObjectId(dto.driverId);
    order.orderStatus = 'assigned';
    await order.save();

    return this.deliveryModel.create({
      orderId: order._id,
      driverId: dto.driverId,
      status: 'assigned',
      assignedAt: new Date(),
    });
  }

  async my(driverId: string, page?: number, limit?: number, filters?: { q?: string; status?: string; orderId?: string }) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(filters?.q);
    const filter: any = { driverId };
    if (filters?.status) filter.status = filters.status;
    if (filters?.orderId) filter.orderId = filters.orderId;
    if (qRegex) filter.$or = [{ status: qRegex }];
    const [data, total] = await Promise.all([
      this.deliveryModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.deliveryModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async updateStatus(id: string, dto: UpdateDeliveryStatusDto, actor: any) {
    const delivery = await this.deliveryModel.findById(id);
    if (!delivery) throw new NotFoundException('Delivery not found');

    if (actor.role === UserRole.DRIVER && String(delivery.driverId) !== String(actor.sub)) {
      throw new ForbiddenException('You can only update your own deliveries');
    }

    const order = await this.orderModel.findById(delivery.orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (actor.role === UserRole.MANAGER && String(order.restaurantId) !== String(actor.restaurantId)) {
      throw new ForbiddenException('You can only update deliveries for your restaurant');
    }

    delivery.status = dto.status;
    if (dto.status === 'delivered') delivery.deliveredAt = new Date();
    await delivery.save();

    order.orderStatus = dto.status === 'delivered' ? 'delivered' : dto.status;
    await order.save();
    return delivery;
  }
}
