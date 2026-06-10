import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BalanceOwnerType } from './balance-transaction.schema';
export type WithdrawalRequestDocument = HydratedDocument<WithdrawalRequest>;
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'paid';

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
  @Prop({ enum: ['pending', 'approved', 'rejected', 'failed', 'paid'], default: 'pending' }) status: WithdrawalStatus;
  @Prop({ default: 'digikuntz' }) provider?: string;
  @Prop() providerRef?: string;
  @Prop() transactionRef?: string;
  @Prop() providerStatus?: string;
  @Prop({ type: Object }) providerPayload?: Record<string, any>;
  @Prop() note?: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) processedBy?: Types.ObjectId;
  @Prop() processedAt?: Date;
}
export const WithdrawalRequestSchema = SchemaFactory.createForClass(WithdrawalRequest);
WithdrawalRequestSchema.index({ ownerType: 1, restaurantId: 1, userId: 1, createdAt: -1 });
