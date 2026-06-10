import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type RestaurantDocument = HydratedDocument<Restaurant>;

@Schema({ timestamps: true })
export class Restaurant {
  @Prop({ required: true }) name: string;
  @Prop({ required: true, unique: true }) slug: string;
  @Prop({ default: false }) top: boolean;
  @Prop({ type: Number, default: 9999, min: 0 }) order: number;
  @Prop() description?: string;
  @Prop() phone1?: string;
  @Prop() phone2?: string;
  @Prop() email?: string;
  @Prop() slogang?: string;
  @Prop() localisation?: string;
  @Prop() ouverture?: string;
  @Prop() logo?: string;
  @Prop() bannerImage?: string;
  @Prop() coverImage?: string;
  @Prop() phone?: string;
  @Prop({ enum: ['active', 'inactive'], default: 'active' }) status: 'active'|'inactive';
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) managerId?: Types.ObjectId;
}
export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);
RestaurantSchema.index({ status: 1, order: 1, createdAt: -1 });
