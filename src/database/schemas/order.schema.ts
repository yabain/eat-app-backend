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
  /**
   * Optionnel au niveau schema : la contrainte « adresse obligatoire » est
   * appliquée côté service (`placeOrderWithinSession` refuse une commande
   * delivery sans adresse complète). Les commandes `on_site` n'en ont pas.
   */
  @Prop({ type: Object, default: null }) deliveryAddress?: DeliveryAddress | null;
  /** 'delivery' (défaut) ou 'on_site' (commande au comptoir créée par le personnel). */
  @Prop({ enum: ['delivery', 'on_site'], default: 'delivery' }) orderType: string;
  @Prop({ type: Object, required: true }) pricingSnapshot: PricingSnapshot;
  @Prop({ type: Number, default: 0 }) deliveryEstimateMinutes?: number;
  @Prop() promoCode?: string;
  @Prop({ enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING })
  paymentStatus: string;
  @Prop({ enum: Object.values(OrderStatus), default: OrderStatus.PENDING_PAYMENT })
  orderStatus: string;
  @Prop() notes?: string;
  /** Étiquette de table saisie par le personnel (ex. "Table 3"). Phase 2 : positionId. */
  @Prop() tableLabel?: string;
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) assignedDriverId?: Types.ObjectId;
  @Prop() outForDeliveryAt?: Date;
  @Prop() paymentConfirmedAt?: Date;
  /**
   * Paiement qui a effectivement fait passer la commande à PAID.
   * Sert de source canonique pour la répartition : même si plusieurs
   * tentatives ont existé, une seule part est créditée par commande.
   */
  @Prop({ type: Types.ObjectId, ref: 'Payment', default: null }) paidPaymentId?: Types.ObjectId | null;
  /** Date à laquelle la part livreur a été réglée (ou constatée nulle). */
  @Prop({ default: null }) driverShareSettledAt?: Date | null;
  /**
   * Anomalie de répartition bloquant définitivement le crédit (ex.
   * `inconsistent_distribution`). Exclut la commande des crons de reprise
   * pour éviter une boucle de logs/scan ; correction manuelle requise.
   */
  @Prop({ default: null }) settlementError?: string | null;
  @Prop() preparationReminderSentAt?: Date;
  @Prop() deliveryStartedWhatsappSentAt?: Date;
  /** Paiement reçu après expiration sans stock suffisant : à rembourser manuellement (paiement réel, commande non honorable). */
  @Prop({ enum: ['paid_without_stock'] }) paymentAnomaly?: string;
}
export const OrderSchema = SchemaFactory.createForClass(Order);
// Réconciliation des parts livreur et des crédits manquants.
OrderSchema.index({
  paymentStatus: 1,
  orderStatus: 1,
  driverShareSettledAt: 1,
  updatedAt: 1,
});
// Page de commande on-site du staff : commandes d'un restaurant par type et statut.
OrderSchema.index({ restaurantId: 1, orderType: 1, orderStatus: 1, createdAt: -1 });
