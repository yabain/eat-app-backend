import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type BalanceTransactionDocument = HydratedDocument<BalanceTransaction>;

export type BalanceOwnerType = 'restaurant' | 'user' | 'system';
export type BalanceTransactionType = 'credit' | 'debit';

@Schema({ timestamps: true })
export class BalanceTransaction {
  @Prop({ enum: ['restaurant', 'user', 'system'], required: true, default: 'restaurant' }) ownerType: BalanceOwnerType;
  @Prop({ type: Types.ObjectId, ref: 'Restaurant' }) restaurantId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) userId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Order' }) orderId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Payment' }) paymentId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'WithdrawalRequest' }) withdrawalId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  @Prop({ required: true }) amount: number;
  @Prop({ default: 'credit', enum: ['credit', 'debit'] }) type: BalanceTransactionType;
  @Prop({ default: 'order_payment' }) reason: string;
  @Prop() note?: string;
  @Prop({ default: 'XAF' }) currency: string;
}
export const BalanceTransactionSchema = SchemaFactory.createForClass(BalanceTransaction);
BalanceTransactionSchema.index(
  { paymentId: 1, ownerType: 1, restaurantId: 1, userId: 1, reason: 1 },
  { unique: true, partialFilterExpression: { paymentId: { $exists: true } } },
);
BalanceTransactionSchema.index(
  { withdrawalId: 1, reason: 1 },
  { unique: true, partialFilterExpression: { withdrawalId: { $exists: true } } },
);
BalanceTransactionSchema.index({ ownerType: 1, restaurantId: 1, userId: 1, createdAt: -1 });
