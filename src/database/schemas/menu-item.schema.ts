import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type MenuItemDocument = HydratedDocument<MenuItem>;

@Schema({ timestamps: true })
export class MenuItem {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Category', default: null }) categoryId?: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop() description?: string;
  @Prop() image?: string;
  @Prop({ required: true }) price: number;
  @Prop({ default: 0 }) packagingCost: number;
  @Prop({ default: 0 }) stock: number;
  @Prop({ default: true }) isAvailable: boolean;
  @Prop({ default: true }) isActive: boolean;
}
export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);
