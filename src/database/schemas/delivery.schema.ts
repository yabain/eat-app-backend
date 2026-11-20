import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
export type DeliveryDocument = HydratedDocument<Delivery>;

@Schema({ timestamps: true })
export class Delivery {
  // `SchemaTypes.ObjectId` (et non `Types.ObjectId`) : ce dernier produit un
  // chemin Mongoose `Mixed`, qui ne caste pas les strings et casse les
  // requêtes `driverId`/`orderId` ainsi que les populate.
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Order', required: true }) orderId: Types.ObjectId;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true }) driverId: Types.ObjectId;
  @Prop({ enum: ['assigned','picked_up','out_for_delivery','delivered','failed'], default: 'assigned' }) status: string;
  @Prop() assignedAt?: Date;
  @Prop() outForDeliveryAt?: Date;
  @Prop() deliveredAt?: Date;
  @Prop() startReminderSentAt?: Date;
}
export const DeliverySchema = SchemaFactory.createForClass(Delivery);
