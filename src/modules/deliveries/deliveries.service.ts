import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Delivery, DeliveryDocument } from '../../database/schemas/delivery.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
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
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
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
    if (filters?.status) {
      const statuses = filters.status.split(',').map((status) => status.trim()).filter(Boolean);
      filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (filters?.orderId) filter.orderId = filters.orderId;

    if (qRegex) {
      const [restaurants, users] = await Promise.all([
        this.restaurantModel.find({ name: qRegex }).select('_id'),
        this.userModel.find({
          $or: [
            { firstName: qRegex },
            { lastName: qRegex },
            { email: qRegex },
            { phone: qRegex },
          ],
        }).select('_id'),
      ]);

      const orderFilter: any = {
        $or: [
          { orderNumber: qRegex },
          { orderStatus: qRegex },
          { 'deliveryAddress.city': qRegex },
          { 'deliveryAddress.district': qRegex },
          { 'deliveryAddress.details': qRegex },
        ],
      };

      const restaurantIds = restaurants.map((restaurant) => restaurant._id);
      const userIds = users.map((user) => user._id);
      if (restaurantIds.length) orderFilter.$or.push({ restaurantId: { $in: restaurantIds } });
      if (userIds.length) orderFilter.$or.push({ userId: { $in: userIds } });
      if (Types.ObjectId.isValid(filters?.q || '')) orderFilter.$or.push({ _id: new Types.ObjectId(filters?.q) });

      const orders = await this.orderModel.find(orderFilter).select('_id');
      const orderIds = orders.map((order) => order._id);
      filter.$or = [{ status: qRegex }];
      if (orderIds.length) filter.$or.push({ orderId: { $in: orderIds } });
    }

    const [data, total] = await Promise.all([
      this.deliveryModel
        .find(filter)
        .populate({
          path: 'orderId',
          populate: [
            {
              path: 'restaurantId',
            },
            {
              path: 'userId',
              select: 'firstName lastName email phone profileImage role restaurantId isActive',
            },
            {
              path: 'assignedDriverId',
              select: 'firstName lastName email phone profileImage role restaurantId isActive',
            },
          ],
        })
        .populate({
          path: 'driverId',
          select: 'firstName lastName email phone profileImage role restaurantId isActive',
        })
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
    if (dto.status === 'out_for_delivery' && !delivery.outForDeliveryAt) delivery.outForDeliveryAt = new Date();
    if (dto.status === 'delivered') delivery.deliveredAt = new Date();
    await delivery.save();

    order.orderStatus = dto.status === 'delivered' ? 'delivered' : dto.status;
    if (dto.status === 'out_for_delivery' && !order.outForDeliveryAt) order.outForDeliveryAt = new Date();
    await order.save();
    return delivery;
  }
}
