import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true, unique: true }) name: string;
  @Prop() description?: string;
  @Prop() image?: string;
  @Prop({ default: true }) isActive: boolean;
  @Prop({ default: false }) isDefault: boolean;
  @Prop({ default: false }) resetStockAtMidnight: boolean;
  @Prop({ type: Number, default: 0, min: 0 }) systemFeePerItem: number;
  @Prop({ type: Number, default: 0, min: 0 }) maxItemsPerOrder: number;
}
export const CategorySchema = SchemaFactory.createForClass(Category);
