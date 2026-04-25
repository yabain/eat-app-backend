import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true }) orderId: Types.ObjectId;
  @Prop({ default: 'digikuntz' }) provider: string;
  @Prop({ required: true }) amount: number;
  @Prop({ default: 'XAF' }) currency: string;
  @Prop({ enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING }) status: string;
  @Prop() providerRef?: string;
  @Prop({ type: Object }) callbackPayload?: Record<string, any>;
  @Prop() initiatedAt?: Date;
  @Prop() completedAt?: Date;
}
export const PaymentSchema = SchemaFactory.createForClass(Payment);
