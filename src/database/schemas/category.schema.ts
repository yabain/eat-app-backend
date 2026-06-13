import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true })
export class CategoryAccompaniment {
  _id?: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ default: true }) isActive: boolean;
  @Prop({ default: 0 }) order: number;
}
export const CategoryAccompanimentSchema = SchemaFactory.createForClass(CategoryAccompaniment);

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
  /**
   * Accompagnements proposés au client lors de l'ajout au panier d'un menu
   * item de cette catégorie. Le menu item définit ensuite la liste des
   * accompagnements disponibles parmi cette liste-mère
   * (cf. MenuItem.availableAccompanimentIds).
   */
  @Prop({ type: [CategoryAccompanimentSchema], default: [] })
  accompaniments: CategoryAccompaniment[];
}
export const CategorySchema = SchemaFactory.createForClass(Category);
