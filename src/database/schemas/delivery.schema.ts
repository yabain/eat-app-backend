import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type DeliveryDocument = HydratedDocument<Delivery>;

@Schema({ timestamps: true })
export class Delivery {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true }) orderId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) driverId: Types.ObjectId;
  @Prop({ enum: ['assigned','picked_up','out_for_delivery','delivered','failed'], default: 'assigned' }) status: string;
  @Prop() assignedAt?: Date;
  @Prop() deliveredAt?: Date;
}
export const DeliverySchema = SchemaFactory.createForClass(Delivery);
