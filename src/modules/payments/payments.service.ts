import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payment, PaymentDocument } from '../../database/schemas/payment.schema';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import { DigikuntzProvider } from './providers/digikuntz.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { UserRole } from '../../common/enums/roles.enum';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private provider: DigikuntzProvider,
    private notifications: NotificationsService,
  ) {}

  private assertOrderAccess(order: OrderDocument, actor: any) {
    if (actor.role === UserRole.ADMIN) return;
    if (actor.role === UserRole.CLIENT && String(order.userId) === String(actor.sub)) return;
    if (
      [UserRole.MANAGER, UserRole.EMPLOYEE].includes(actor.role)
      && String(order.restaurantId) === String(actor.restaurantId)
    ) return;
    throw new ForbiddenException('You are not allowed to access this order payment');
  }

  async initiate(orderId: string, actor: any) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    this.assertOrderAccess(order, actor);
    if (order.paymentStatus === PaymentStatus.PAID) throw new BadRequestException('Order already paid');
    const user = await this.userModel.findById(order.userId);
    const response = await this.provider.initiatePayment(order.orderNumber, order.pricingSnapshot.grandTotal, user?.phone);
    const payment = await this.paymentModel.create({
      orderId: order._id,
      amount: order.pricingSnapshot.grandTotal,
      provider: 'digikuntz',
      currency: 'XAF',
      status: PaymentStatus.PROCESSING,
      providerRef: response.providerRef,
      initiatedAt: new Date(),
    });
    order.paymentStatus = PaymentStatus.PROCESSING;
    await order.save();
    return { payment, checkout: response };
  }

  async paymentStatus(orderId: string, actor: any) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    this.assertOrderAccess(order, actor);
    return this.paymentModel.findOne({ orderId }).sort({ createdAt: -1 });
  }

  async webhook(payload: any) {
    const payment = await this.paymentModel.findOne({ providerRef: payload.providerRef });
    if (!payment) throw new NotFoundException('Payment not found');
    const order = await this.orderModel.findById(payment.orderId);
    if (!order) throw new NotFoundException('Order not found');

    const success = ['paid', 'success', 'completed'].includes(String(payload.status).toLowerCase());
    payment.status = success ? PaymentStatus.PAID : PaymentStatus.FAILED;
    payment.callbackPayload = payload;
    payment.completedAt = new Date();
    await payment.save();

    order.paymentStatus = success ? PaymentStatus.PAID : PaymentStatus.FAILED;
    order.orderStatus = success ? OrderStatus.PAID : OrderStatus.PAYMENT_FAILED;
    await order.save();

    if (success) {
      const user = await this.userModel.findById(order.userId);
      if (user) await this.notifications.sendOrderConfirmed(user.email, user.phone, order.orderNumber);
    }
    return { ok: true };
  }
}
