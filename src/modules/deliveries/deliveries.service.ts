import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Delivery, DeliveryDocument } from '../../database/schemas/delivery.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';
import { UserRole } from '../../common/enums/roles.enum';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { orderStatusForDeliveryStatus } from '../../common/utils/delivery-order-status.util';
import { AssignDeliveryDto } from './dto/assign-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    @InjectModel(Delivery.name) private deliveryModel: Model<DeliveryDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly paymentsService: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  private displayName(user: any) {
    return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || user?.phone || '';
  }

  private orderAddress(order: any) {
    const address = order?.deliveryAddress || {};
    return [address.district, address.city, address.details].filter(Boolean).join(', ');
  }

  private async notifyDeliveryAssigned(delivery: DeliveryDocument | null) {
    if (!delivery) return;
    try {
      const [order, driver] = await Promise.all([
        this.orderModel.findById(delivery.orderId).populate('restaurantId').populate({
          path: 'userId',
          select: 'firstName lastName email phone',
        }),
        this.userModel.findById(delivery.driverId).select('firstName lastName email phone'),
      ]);
      if (!order || !driver) return;
      const restaurant = order.restaurantId as any;
      const client = order.userId as any;
      await this.notifications.sendDeliveryAssigned(driver.email, {
        orderNumber: order.orderNumber,
        driverName: this.displayName(driver),
        restaurantName: restaurant?.name,
        clientName: this.displayName(client),
        clientPhone: client?.phone,
        address: this.orderAddress(order),
        total: Number(order.pricingSnapshot?.grandTotal || 0),
      });
    } catch (error: any) {
      // L'assignation ne doit pas échouer si le mail est indisponible.
      // Le logger de NotificationsService détaille déjà les erreurs SMTP.
      this.logger.warn(`Unable to notify driver for delivery ${delivery._id}: ${error?.message || error}`);
    }
  }

  async assign(dto: AssignDeliveryDto, actor: any) {
    const session = await this.connection.startSession();
    try {
      let delivery: DeliveryDocument | null = null;
      await session.withTransaction(async () => {
        const order = await this.orderModel.findById(dto.orderId).session(session);
        if (!order) throw new NotFoundException('Order not found');
        if (actor.role === UserRole.MANAGER && String(order.restaurantId) !== String(actor.restaurantId)) {
          throw new ForbiddenException('You can only assign deliveries for your restaurant');
        }
        if (order.assignedDriverId) throw new BadRequestException('Order already has an assigned driver');
        if (order.orderStatus !== OrderStatus.READY) throw new BadRequestException('Only ready orders can be assigned');

        const activeDelivery = await this.deliveryModel.findOne({
          orderId: order._id,
          status: { $in: ['assigned', 'picked_up', 'out_for_delivery'] },
        }).session(session);
        if (activeDelivery) throw new BadRequestException('Order already has an active delivery');

        const driver = await this.userModel.findById(dto.driverId).session(session);
        if (!driver) throw new NotFoundException('Driver not found');
        if (driver.role !== UserRole.DRIVER) throw new BadRequestException('Assigned user must be a driver');
        if (driver.isActive === false) throw new BadRequestException('Assigned driver is inactive');
        if (driver.isDriverAvailable === false) throw new BadRequestException('Assigned driver is unavailable');
        if (actor.role === UserRole.MANAGER && String(driver.restaurantId || '') !== String(actor.restaurantId || '')) {
          throw new ForbiddenException('Manager can only assign drivers from their restaurant');
        }

        order.assignedDriverId = new Types.ObjectId(dto.driverId);
        order.orderStatus = OrderStatus.ASSIGNED;
        driver.isDriverAvailable = false;
        await order.save({ session });
        await driver.save({ session });

        [delivery] = await this.deliveryModel.create([{
          orderId: order._id,
          driverId: dto.driverId,
          status: 'assigned',
          assignedAt: new Date(),
        }], { session });
      });
      await this.notifyDeliveryAssigned(delivery);
      return delivery;
    } finally {
      await session.endSession();
    }
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
              select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable',
            },
            {
              path: 'assignedDriverId',
              select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable isDriverAvailable',
            },
          ],
        })
        .populate({
          path: 'driverId',
          select: 'firstName lastName email phone profileImage role restaurantId isActive isDriverAvailable isDriverAvailable',
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

    const previousStatus = delivery.status;
    delivery.status = dto.status;
    if (dto.status === 'out_for_delivery' && !delivery.outForDeliveryAt) delivery.outForDeliveryAt = new Date();
    if (dto.status === 'delivered') delivery.deliveredAt = new Date();
    await delivery.save();

    const nextOrderStatus = orderStatusForDeliveryStatus(dto.status);
    if (nextOrderStatus) {
      order.orderStatus = nextOrderStatus;
      if (dto.status === 'out_for_delivery' && !order.outForDeliveryAt) order.outForDeliveryAt = new Date();
      await order.save();
    }
    if (dto.status === 'delivered') {
      await this.userModel.updateOne(
        { _id: delivery.driverId, role: UserRole.DRIVER },
        { $set: { isDriverAvailable: true } },
      );

      try {
        await this.paymentsService.ensurePaidOrderBalances(order, delivery.driverId);
      } catch (error: any) {
        this.logger.error(
          `Failed to credit balances for delivered order ${order._id}: ${error?.message || error}`,
          error?.stack,
        );
      }
    }
    if (dto.status === 'failed' && previousStatus !== 'failed') {
      await this.userModel.updateOne(
        { _id: delivery.driverId, role: UserRole.DRIVER },
        { $set: { isDriverAvailable: true } },
      );
    }
    return delivery;
  }
}
