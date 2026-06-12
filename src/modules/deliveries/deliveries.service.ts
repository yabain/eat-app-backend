import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Delivery, DeliveryDocument } from '../../database/schemas/delivery.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { DeliveryZone, DeliveryZoneDocument } from '../../database/schemas/delivery-zone.schema';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';
import { UserRole } from '../../common/enums/roles.enum';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { orderStatusForDeliveryStatus } from '../../common/utils/delivery-order-status.util';
import { AssignDeliveryDto } from './dto/assign-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DispatchSettings, DispatchSettingsDocument } from '../../database/schemas/dispatch-settings.schema';
import { DeliveryStatus } from '../../common/enums/delivery-status.enum';
import {
  allowedDeliveryStatuses,
  canTransitionDeliveryStatus,
} from '../../common/utils/delivery-status-transition.util';

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    @InjectModel(Delivery.name) private deliveryModel: Model<DeliveryDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(DeliveryZone.name) private deliveryZoneModel: Model<DeliveryZoneDocument>,
    @InjectModel(DispatchSettings.name) private dispatchSettingsModel: Model<DispatchSettingsDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly paymentsService: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  private readonly autoDispatchKey = 'auto-dispatch';

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
      await this.notifications.sendDeliveryAssigned(driver.email, driver.phone, {
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

  private notifyDelivered(order: OrderDocument) {
    this.userModel.findById(order.userId).select('email phone').then((user) => {
      if (!user) return;
      void this.notifications.sendDelivered(user.email, user.phone, order.orderNumber);
    }).catch((error: any) => {
      this.logger.warn(`Unable to notify delivered order ${order._id}: ${error?.message || error}`);
    });
  }

  private async notifyDeliveryStarted(order: OrderDocument) {
    const client = await this.userModel.findById(order.userId).select('phone');
    if (!client?.phone) return;

    const claimedOrder = await this.orderModel.findOneAndUpdate(
      {
        _id: order._id,
        deliveryStartedWhatsappSentAt: { $exists: false },
      },
      { $set: { deliveryStartedWhatsappSentAt: new Date() } },
      { new: true },
    );
    if (!claimedOrder) return;
    this.notifications.sendDeliveryStartedWhatsapp(client.phone, order.orderNumber);
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

  async getAutoDispatchSettings() {
    const settings = await this.getOrCreateAutoDispatchSettings();
    return {
      enabled: settings.enabled,
      intervalMinutes: 3,
      lastRunAt: settings.lastRunAt || null,
      lastAssignedCount: settings.lastAssignedCount || 0,
    };
  }

  async updateAutoDispatchSettings(enabled: boolean) {
    const settings = await this.dispatchSettingsModel.findOneAndUpdate(
      { key: this.autoDispatchKey },
      { $set: { enabled }, $setOnInsert: { key: this.autoDispatchKey } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    this.logger.log(`Automatic delivery dispatch ${enabled ? 'enabled' : 'disabled'}`);
    return {
      enabled: settings.enabled,
      intervalMinutes: 3,
      lastRunAt: settings.lastRunAt || null,
      lastAssignedCount: settings.lastAssignedCount || 0,
    };
  }

  /** Capacité maximale de commandes actives simultanément par livreur. */
  private static readonly MAX_ACTIVE_DELIVERIES_PER_DRIVER = 5;

  @Cron('*/3 * * * *')
  async runAutomaticDispatch() {
    const settings = await this.getOrCreateAutoDispatchSettings();
    if (!settings.enabled) return;

    let assignedCount = 0;
    let assignedGroups = 0;

    try {
      // 1) Pool des livreurs candidats (actifs, on duty) avec leur capacité restante.
      //    On considère "actives" toutes les livraisons dont le statut implique
      //    qu'elles ne sont pas encore livrées ni échouées.
      const drivers = await this.userModel
        .find({
          role: UserRole.DRIVER,
          isActive: { $ne: false },
          isDriverAvailable: { $ne: false },
        })
        .select('_id')
        .lean();
      if (!drivers.length) return;

      const driverIds = drivers.map((d) => d._id);
      const activeCounts = await this.deliveryModel.aggregate([
        {
          $match: {
            driverId: { $in: driverIds },
            status: { $in: [DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.OUT_FOR_DELIVERY] },
          },
        },
        { $group: { _id: '$driverId', count: { $sum: 1 } } },
      ]);
      const capacities = new Map<string, number>();
      for (const driver of drivers) {
        capacities.set(String(driver._id), DeliveriesService.MAX_ACTIVE_DELIVERIES_PER_DRIVER);
      }
      for (const row of activeCounts) {
        const driverIdKey = String(row._id);
        const remaining = Math.max(
          0,
          DeliveriesService.MAX_ACTIVE_DELIVERIES_PER_DRIVER - Number(row.count || 0),
        );
        capacities.set(driverIdKey, remaining);
      }

      // 2) Charge la table des zones (city|district -> zoneNumber).
      const zones = await this.deliveryZoneModel
        .find({ isActive: { $ne: false } })
        .select({ city: 1, district: 1, zoneNumber: 1 })
        .lean();
      const zoneByLocation = new Map<string, string>();
      for (const zone of zones) {
        if (!zone.zoneNumber) continue;
        const key = this.zoneKey(zone.city, zone.district);
        zoneByLocation.set(key, String(zone.zoneNumber).trim());
      }

      // 3) Charge les commandes prêtes sans livreur affecté.
      const orders = await this.orderModel
        .find({
          orderStatus: OrderStatus.READY,
          $or: [
            { assignedDriverId: null },
            { assignedDriverId: { $exists: false } },
          ],
        })
        .sort({ createdAt: 1 })
        .select({ _id: 1, restaurantId: 1, deliveryAddress: 1, createdAt: 1 })
        .lean();
      if (!orders.length) return;

      // 4) Groupe par (restaurantId, zoneNumber). Les commandes sans zoneNumber
      //    connu forment chacune un groupe à 1 élément (= dispatch individuel).
      const groupsMap = new Map<string, { restaurantId: string; zoneNumber: string | null; orders: any[] }>();
      for (const order of orders) {
        const restaurantId = String(order.restaurantId || '');
        const locKey = this.zoneKey(
          (order.deliveryAddress as any)?.city,
          (order.deliveryAddress as any)?.district,
        );
        const zoneNumber = zoneByLocation.get(locKey) || null;
        const groupKey = zoneNumber
          ? `${restaurantId}|${zoneNumber}`
          : `${restaurantId}|solo:${String(order._id)}`;
        let group = groupsMap.get(groupKey);
        if (!group) {
          group = { restaurantId, zoneNumber, orders: [] };
          groupsMap.set(groupKey, group);
        }
        group.orders.push(order);
      }

      // 5) Tri des groupes : zones identifiées d'abord, puis par taille décroissante,
      //    puis par âge (oldest first) pour respecter l'équité FIFO.
      const groups = Array.from(groupsMap.values()).sort((a, b) => {
        const aHasZone = a.zoneNumber ? 1 : 0;
        const bHasZone = b.zoneNumber ? 1 : 0;
        if (aHasZone !== bHasZone) return bHasZone - aHasZone;
        if (a.orders.length !== b.orders.length) return b.orders.length - a.orders.length;
        const aOldest = new Date(a.orders[0].createdAt || 0).getTime();
        const bOldest = new Date(b.orders[0].createdAt || 0).getTime();
        return aOldest - bOldest;
      });

      // 6) Pour chaque groupe : choisit le livreur avec la plus grande capacité
      //    restante (ex-aequo : aléatoire). Assigne min(taille du groupe, capacité)
      //    commandes à ce livreur — le reste sera traité au prochain run.
      for (const group of groups) {
        if (!group.orders.length) continue;

        // Sélectionne le driver avec le plus de capacité (>0). Tirage aléatoire
        // sur ex-aequo pour répartir la charge.
        const candidates = Array.from(capacities.entries())
          .filter(([, cap]) => cap > 0)
          .sort((a, b) => b[1] - a[1] || (Math.random() - 0.5));
        if (!candidates.length) break; // plus de capacité globalement

        const [chosenDriverId, capacity] = candidates[0];
        const take = Math.min(group.orders.length, capacity);
        const slice = group.orders.slice(0, take);

        for (const order of slice) {
          try {
            const delivery = await this.dispatchAssign(String(order._id), chosenDriverId);
            this.notifyDeliveryAssigned(delivery).catch(() => undefined);
            assignedCount += 1;
          } catch (error: any) {
            this.logger.warn(
              `Automatic dispatch skipped order ${order._id}: ${error?.message || error}`,
            );
          }
        }
        capacities.set(chosenDriverId, capacity - take);
        if (slice.length) assignedGroups += 1;
      }
    } catch (error: any) {
      this.logger.error(`Automatic dispatch failed: ${error?.message || error}`, error?.stack);
    } finally {
      await this.dispatchSettingsModel.updateOne(
        { key: this.autoDispatchKey },
        {
          $set: {
            lastRunAt: new Date(),
            lastAssignedCount: assignedCount,
          },
        },
      );
    }

    if (assignedCount) {
      this.logger.log(
        `Automatic dispatch assigned ${assignedCount} order(s) across ${assignedGroups} group(s)`,
      );
    }
  }

  /**
   * Affecte une commande à un livreur sans toucher au flag `isDriverAvailable`
   * (le flag est piloté manuellement par le livreur ; la capacité réelle est
   * désormais déterminée par le compteur d'actives < 5). Crée la Delivery + met
   * à jour la commande dans une transaction. À utiliser uniquement par le cron
   * de dispatch — l'assignation manuelle continue de passer par `assign()`.
   */
  private async dispatchAssign(orderId: string, driverId: string): Promise<DeliveryDocument | null> {
    const session = await this.connection.startSession();
    let delivery: DeliveryDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const order = await this.orderModel.findById(orderId).session(session);
        if (!order) throw new NotFoundException('Order not found');
        if (order.assignedDriverId) throw new BadRequestException('Order already has an assigned driver');
        if (order.orderStatus !== OrderStatus.READY) throw new BadRequestException('Only ready orders can be assigned');

        const activeDelivery = await this.deliveryModel
          .findOne({
            orderId: order._id,
            status: { $in: [DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.OUT_FOR_DELIVERY] },
          })
          .session(session);
        if (activeDelivery) throw new BadRequestException('Order already has an active delivery');

        const driver = await this.userModel.findById(driverId).session(session);
        if (!driver) throw new NotFoundException('Driver not found');
        if (driver.role !== UserRole.DRIVER) throw new BadRequestException('Assigned user must be a driver');
        if (driver.isActive === false) throw new BadRequestException('Assigned driver is inactive');

        order.assignedDriverId = new Types.ObjectId(driverId);
        order.orderStatus = OrderStatus.ASSIGNED;
        await order.save({ session });

        [delivery] = await this.deliveryModel.create(
          [{
            orderId: order._id,
            driverId: new Types.ObjectId(driverId),
            status: DeliveryStatus.ASSIGNED,
            assignedAt: new Date(),
          }],
          { session },
        );
      });
      return delivery;
    } finally {
      await session.endSession();
    }
  }

  private zoneKey(city: any, district: any): string {
    return `${String(city || '').trim().toLowerCase()}|${String(district || '').trim().toLowerCase()}`;
  }

  private async getOrCreateAutoDispatchSettings() {
    const existing = await this.dispatchSettingsModel.findOne({ key: this.autoDispatchKey });
    if (existing) return existing;
    return this.dispatchSettingsModel.create({
      key: this.autoDispatchKey,
      enabled: false,
      lastAssignedCount: 0,
    });
  }

  private shuffle<T>(items: T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }
    return shuffled;
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
    const session = await this.connection.startSession();
    let delivery: DeliveryDocument | null = null;
    let order: OrderDocument | null = null;
    let notifyStarted = false;
    let notifyCompleted = false;

    try {
      await session.withTransaction(async () => {
        delivery = await this.deliveryModel.findById(id).session(session);
        if (!delivery) throw new NotFoundException('Delivery not found');

        if (actor.role === UserRole.DRIVER && String(delivery.driverId) !== String(actor.sub)) {
          throw new ForbiddenException('You can only update your own deliveries');
        }

        order = await this.orderModel.findById(delivery.orderId).session(session);
        if (!order) throw new NotFoundException('Order not found');
        if (actor.role === UserRole.MANAGER && String(order.restaurantId) !== String(actor.restaurantId)) {
          throw new ForbiddenException('You can only update deliveries for your restaurant');
        }

        const previousStatus = delivery.status as DeliveryStatus;
        const nextStatus = dto.status as DeliveryStatus;
        if (!canTransitionDeliveryStatus(previousStatus, nextStatus)) {
          const allowed = allowedDeliveryStatuses(previousStatus);
          throw new BadRequestException(
            allowed.length
              ? `Transition de livraison invalide. Statuts autorisés: ${allowed.join(', ')}`
              : `La livraison au statut ${previousStatus} est clôturée`,
          );
        }

        delivery.status = nextStatus;
        if (nextStatus === DeliveryStatus.OUT_FOR_DELIVERY && !delivery.outForDeliveryAt) {
          delivery.outForDeliveryAt = new Date();
        }
        if (nextStatus === DeliveryStatus.DELIVERED) delivery.deliveredAt = new Date();
        await delivery.save({ session });

        if (nextStatus === DeliveryStatus.FAILED) {
          order.orderStatus = OrderStatus.READY;
          order.assignedDriverId = null as any;
        } else {
          const nextOrderStatus = orderStatusForDeliveryStatus(nextStatus);
          if (nextOrderStatus) order.orderStatus = nextOrderStatus;
          if (nextStatus === DeliveryStatus.OUT_FOR_DELIVERY && !order.outForDeliveryAt) {
            order.outForDeliveryAt = new Date();
          }
        }
        await order.save({ session });

        if ([DeliveryStatus.DELIVERED, DeliveryStatus.FAILED].includes(nextStatus)) {
          await this.userModel.updateOne(
            { _id: delivery.driverId, role: UserRole.DRIVER },
            { $set: { isDriverAvailable: true } },
            { session },
          );
        }

        notifyStarted = nextStatus === DeliveryStatus.OUT_FOR_DELIVERY;
        notifyCompleted = nextStatus === DeliveryStatus.DELIVERED;
      });
    } finally {
      await session.endSession();
    }

    if (!delivery || !order) throw new NotFoundException('Delivery not found');
    if (notifyStarted) await this.notifyDeliveryStarted(order);
    if (notifyCompleted) {
      this.notifyDelivered(order);
      try {
        await this.paymentsService.ensurePaidOrderBalances(order, delivery.driverId);
      } catch (error: any) {
        this.logger.error(
          `Failed to credit balances for delivered order ${order._id}: ${error?.message || error}`,
          error?.stack,
        );
      }
    }
    return delivery;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sendOperationalReminders() {
    const reminderMinutes = 10;
    const cutoff = new Date(Date.now() - reminderMinutes * 60_000);

    await Promise.all([
      this.sendRestaurantPreparationReminders(cutoff, reminderMinutes),
      this.sendDriverStartReminders(cutoff, reminderMinutes),
    ]);
  }

  private async sendRestaurantPreparationReminders(cutoff: Date, elapsedMinutes: number) {
    const candidates = await this.orderModel.find({
      paymentStatus: 'paid',
      orderStatus: {
        $in: [OrderStatus.PAID, OrderStatus.CONFIRMED, OrderStatus.PREPARING],
      },
      preparationReminderSentAt: { $exists: false },
      $or: [
        { paymentConfirmedAt: { $lte: cutoff } },
        { paymentConfirmedAt: { $exists: false }, createdAt: { $lte: cutoff } },
      ],
    }).select('_id').limit(100).lean();

    for (const candidate of candidates) {
      try {
        const order = await this.orderModel.findById(candidate._id);
        if (!order) continue;

        const restaurant = await this.restaurantModel
          .findById(order.restaurantId)
          .select('name managerId');
        const staffFilter: any = {
          isActive: { $ne: false },
          $or: [{
            restaurantId: order.restaurantId,
            role: { $in: [UserRole.MANAGER, UserRole.EMPLOYEE] },
          }],
        };
        if (restaurant?.managerId) staffFilter.$or.push({ _id: restaurant.managerId });

        const staff = await this.userModel.find(staffFilter).select('phone');
        const recipients = staff.filter((member) => Boolean(member.phone));
        if (!recipients.length) continue;

        const claimedOrder = await this.orderModel.findOneAndUpdate(
          {
            _id: order._id,
            paymentStatus: 'paid',
            orderStatus: {
              $in: [OrderStatus.PAID, OrderStatus.CONFIRMED, OrderStatus.PREPARING],
            },
            preparationReminderSentAt: { $exists: false },
          },
          { $set: { preparationReminderSentAt: new Date() } },
          { new: true },
        );
        if (!claimedOrder) continue;

        this.notifications.sendRestaurantPreparationReminder(
          recipients.map((member) => ({ phone: member.phone })),
          {
            orderId: String(order._id),
            orderNumber: order.orderNumber,
            restaurantName: restaurant?.name,
            elapsedMinutes,
          },
        );
      } catch (error: any) {
        this.logger.warn(
          `Unable to send preparation reminder for order ${candidate._id}: ${error?.message || error}`,
        );
      }
    }
  }

  private async sendDriverStartReminders(cutoff: Date, elapsedMinutes: number) {
    const candidates = await this.deliveryModel.find({
      status: { $in: ['assigned', 'picked_up'] },
      assignedAt: { $lte: cutoff },
      startReminderSentAt: { $exists: false },
    }).select('_id').limit(100).lean();

    for (const candidate of candidates) {
      try {
        const delivery = await this.deliveryModel.findById(candidate._id);
        if (!delivery) continue;

        const [order, driver] = await Promise.all([
          this.orderModel.findById(delivery.orderId).populate('restaurantId'),
          this.userModel.findById(delivery.driverId).select('firstName lastName phone'),
        ]);
        if (!order || !driver?.phone) continue;

        const claimedDelivery = await this.deliveryModel.findOneAndUpdate(
          {
            _id: delivery._id,
            status: { $in: ['assigned', 'picked_up'] },
            assignedAt: { $lte: cutoff },
            startReminderSentAt: { $exists: false },
          },
          { $set: { startReminderSentAt: new Date() } },
          { new: true },
        );
        if (!claimedDelivery) continue;

        const restaurant = order.restaurantId as any;
        this.notifications.sendDeliveryStartReminder(driver.phone, {
          orderNumber: order.orderNumber,
          driverName: this.displayName(driver),
          restaurantName: restaurant?.name,
          address: this.orderAddress(order),
          elapsedMinutes,
        });
      } catch (error: any) {
        this.logger.warn(
          `Unable to send delivery start reminder for delivery ${candidate._id}: ${error?.message || error}`,
        );
      }
    }
  }
}
