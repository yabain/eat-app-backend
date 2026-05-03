import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type BalanceTransactionDocument = HydratedDocument<BalanceTransaction>;

@Schema({ timestamps: true })
export class BalanceTransaction {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true }) orderId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true, unique: true }) paymentId: Types.ObjectId;
  @Prop({ required: true }) amount: number;
  @Prop({ default: 'credit' }) type: 'credit' | 'debit';
  @Prop({ default: 'order_payment' }) reason: string;
  @Prop({ default: 'XAF' }) currency: string;
}
export const BalanceTransactionSchema = SchemaFactory.createForClass(BalanceTransaction);
