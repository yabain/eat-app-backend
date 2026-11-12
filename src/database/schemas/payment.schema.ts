import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
export type PaymentDocument = HydratedDocument<Payment>;

/** Méthode de paiement enregistrée pour une demande mobile money directe. */
export const PAYMENT_METHOD_DIRECT_CHARGE = 'direct_charge';

/**
 * Issue d'une demande directe :
 * calling (appel en cours) · prompt_sent (demande envoyée) · refused (refus, lien hébergé) ·
 * unknown (issue inconnue, jamais supprimée ni libérée automatiquement) · rejected (refus certain).
 */
export type DirectChargeOutcome = 'calling' | 'prompt_sent' | 'refused' | 'unknown' | 'rejected';
export const DIRECT_CHARGE_OUTCOMES: DirectChargeOutcome[] = ['calling', 'prompt_sent', 'refused', 'unknown', 'rejected'];

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true }) orderId: Types.ObjectId;
  @Prop({ default: 'digikuntz' }) provider: string;
  @Prop({ required: true }) amount: number;
  @Prop({ default: 'XAF' }) currency: string;
  @Prop({ enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING }) status: string;
  @Prop() providerRef?: string;
  @Prop() transactionRef?: string;
  @Prop() paymentLink?: string;
  @Prop() paymentMethod?: string;
  @Prop() paymentWithTaxes?: number;
  @Prop() invoiceTaxes?: number;
  @Prop({ type: Object }) callbackPayload?: Record<string, any>;
  @Prop() initiatedAt?: Date;
  @Prop() completedAt?: Date;
  /** Opérateur mobile money utilisé pour une demande directe (ORANGEMONEY | MTN). */
  @Prop() directChargeOperator?: string;
  @Prop({ enum: DIRECT_CHARGE_OUTCOMES }) directChargeOutcome?: DirectChargeOutcome;
}
export const PaymentSchema = SchemaFactory.createForClass(Payment);
