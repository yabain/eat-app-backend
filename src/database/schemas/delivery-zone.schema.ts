import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
export type DeliveryZoneDocument = HydratedDocument<DeliveryZone>;

@Schema({ timestamps: true })
export class DeliveryZone {
  @Prop({ required: true }) city: string;
  @Prop({ required: true }) district: string;
  @Prop() details?: string;
  @Prop() mapLink?: string;
  @Prop({ required: true }) deliveryFee: number;
  @Prop({ type: Number, default: 0 }) time: number;
  @Prop({ default: true }) isActive: boolean;
}
export const DeliveryZoneSchema = SchemaFactory.createForClass(DeliveryZone);
