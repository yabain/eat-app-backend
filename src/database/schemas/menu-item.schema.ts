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
  /**
   * Sous-ensemble des accompagnements de la catégorie disponibles pour ce
   * menu item. Chaque entrée référence l'_id d'un Category.accompaniments[i].
   * Si la liste est vide, aucun accompagnement n'est proposé au client.
   */
  @Prop({ type: [Types.ObjectId], default: [] })
  availableAccompanimentIds: Types.ObjectId[];
}
export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);
