import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type CartDocument = HydratedDocument<Cart>;

class CartItem {
  @Prop({ type: Types.ObjectId, ref: 'MenuItem', required: true })
  menuItemId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  quantity: number;

  /**
   * Accompagnement sélectionné par le client lors de l'ajout au panier. Il
   * référence l'_id d'un Category.accompaniments[i] et doit appartenir aux
   * MenuItem.availableAccompanimentIds. Optionnel : null si le menu item
   * n'a pas d'accompagnement.
   */
  @Prop({ type: Types.ObjectId, default: null })
  accompanimentId?: Types.ObjectId | null;

  /** Nom de l'accompagnement, dénormalisé au moment de l'ajout pour l'affichage. */
  @Prop({ default: '' })
  accompanimentName?: string;
}

@Schema({ timestamps: true })
export class Cart {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', default: null })
  restaurantId?: Types.ObjectId | null;

  @Prop({
    type: [
      {
        menuItemId: { type: Types.ObjectId, ref: 'MenuItem', required: true },
        quantity: { type: Number, required: true, min: 1 },
        accompanimentId: { type: Types.ObjectId, default: null },
        accompanimentName: { type: String, default: '' },
      },
    ],
    default: [],
  })
  items: CartItem[];
}

export const CartSchema = SchemaFactory.createForClass(Cart);
