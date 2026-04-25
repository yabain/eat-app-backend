import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type PromoCodeDocument = HydratedDocument<PromoCode>;

@Schema({ timestamps: true })
export class PromoCode {
  @Prop({ required: true, unique: true, uppercase: true }) code: string;
  @Prop({ required: true }) amount: number;
  @Prop({ default: true }) isActive: boolean;
  @Prop() expirationDate?: Date;
  @Prop() usageLimit?: number;
  @Prop({ default: 0 }) usedCount: number;
  @Prop() minOrderAmount?: number;
  @Prop({ type: [Types.ObjectId], ref: 'Restaurant', default: [] }) applicableRestaurantIds?: Types.ObjectId[];
}
export const PromoCodeSchema = SchemaFactory.createForClass(PromoCode);
