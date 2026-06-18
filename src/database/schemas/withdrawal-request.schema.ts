import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BalanceOwnerType } from './balance-transaction.schema';
export type WithdrawalRequestDocument = HydratedDocument<WithdrawalRequest>;
export type WithdrawalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'paid'
  // Gateway DigiKuntz temporairement injoignable lors de l'initiation. Le
  // débit est conservé sur le solde et un cron retry l'initiation chaque
  // minute. Bascule à `failed` (avec refund + notifs) au bout d'1 h.
  | 'gateway_unavailable';

@Schema({ timestamps: true })
export class WithdrawalRequest {
  @Prop({ enum: ['restaurant', 'user', 'system'], required: true }) ownerType: BalanceOwnerType;
  @Prop({ type: Types.ObjectId, ref: 'Restaurant' }) restaurantId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) userId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) requestedBy: Types.ObjectId;
  @Prop({ required: true }) amount: number;
  @Prop({ required: true }) phone: string;
  @Prop({ enum: ['MTN', 'ORANGEMONEY'], default: 'MTN' }) accountBankCode: 'MTN' | 'ORANGEMONEY';
  @Prop({ default: 'XAF' }) currency: string;
  @Prop({
    enum: ['pending', 'approved', 'rejected', 'failed', 'paid', 'gateway_unavailable'],
    default: 'pending',
  })
  status: WithdrawalStatus;
  @Prop({ default: 'digikuntz' }) provider?: string;
  @Prop() providerRef?: string;
  @Prop() transactionRef?: string;
  @Prop() providerStatus?: string;
  @Prop({ type: Object }) providerPayload?: Record<string, any>;
  @Prop() note?: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) processedBy?: Types.ObjectId;
  @Prop() processedAt?: Date;
  /** Premier instant où le gateway a été constaté indisponible (réinitialisé
   *  à null dès qu'on sort de cet état). Sert au cron pour décider du timeout
   *  d'1 h avant bascule en `failed`. */
  @Prop({ default: null }) gatewayUnavailableSince?: Date | null;
  /** Compteur des tentatives ratées pour cause de gateway indisponible. */
  @Prop({ default: 0 }) gatewayUnavailableAttempts?: number;
  /** Dernière tentative effectuée par le cron (utile pour debug). */
  @Prop({ default: null }) lastGatewayRetryAt?: Date | null;
}
export const WithdrawalRequestSchema = SchemaFactory.createForClass(WithdrawalRequest);
WithdrawalRequestSchema.index({ ownerType: 1, restaurantId: 1, userId: 1, createdAt: -1 });
WithdrawalRequestSchema.index({ status: 1, gatewayUnavailableSince: 1 });
