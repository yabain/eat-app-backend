import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
export type OrderDocument = HydratedDocument<Order>;

class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'MenuItem', required: true }) menuItemId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Category', default: null }) categoryId?: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) unitPrice: number;
  @Prop({ required: true }) packagingCost: number;
  @Prop({ type: Number, default: 0 }) systemFeePerItem: number;
  @Prop({ type: Number, default: 0 }) systemFeeTotal: number;
  @Prop({ required: true }) quantity: number;
  @Prop({ required: true }) subtotal: number;
  /** Accompagnement choisi par le client (snapshot au moment de la commande). */
  @Prop({ type: Types.ObjectId, default: null }) accompanimentId?: Types.ObjectId | null;
  @Prop({ default: '' }) accompanimentName?: string;
}
class DeliveryAddress {
  @Prop({ required: true }) city: string;
  @Prop({ required: true }) district: string;
  @Prop({ required: true }) details: string;
  @Prop() mapLink?: string;
}
class PricingSnapshot {
  @Prop({ required: true }) itemsSubtotal: number;
  @Prop({ required: true }) packagingTotal: number;
  @Prop({ required: true }) deliveryFee: number;
  @Prop({ required: true }) platformFee: number;
  @Prop({ required: true }) promoDiscount: number;
  @Prop({ required: true }) paymentAmount: number;
  @Prop({ required: true }) grandTotal: number;
  @Prop({ type: Number, default: 0 }) categorySystemFeeTotal: number;
  @Prop({ type: Number, default: 1 }) balanceDistributionVersion: number;
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true, unique: true }) orderNumber: string;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  @Prop({ type: [Object], default: [] }) items: OrderItem[];
  @Prop({ type: Object, required: true }) deliveryAddress: DeliveryAddress;
  @Prop({ type: Object, required: true }) pricingSnapshot: PricingSnapshot;
  @Prop({ type: Number, default: 0 }) deliveryEstimateMinutes?: number;
  @Prop() promoCode?: string;
  @Prop({ enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING })
  paymentStatus: string;
  @Prop({ enum: Object.values(OrderStatus), default: OrderStatus.PENDING_PAYMENT })
  orderStatus: string;
  @Prop() notes?: string;
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) assignedDriverId?: Types.ObjectId;
  @Prop() outForDeliveryAt?: Date;
  @Prop() paymentConfirmedAt?: Date;
  @Prop() preparationReminderSentAt?: Date;
  @Prop() deliveryStartedWhatsappSentAt?: Date;
}
export const OrderSchema = SchemaFactory.createForClass(Order);
