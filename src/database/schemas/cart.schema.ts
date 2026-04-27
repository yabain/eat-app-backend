import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type CartDocument = HydratedDocument<Cart>;

class CartItem {
  @Prop({ type: Types.ObjectId, ref: 'MenuItem', required: true })
  menuItemId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  quantity: number;
}

@Schema({ timestamps: true })
export class Cart {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', default: null })
  restaurantId?: Types.ObjectId | null;

  @Prop({ type: [{ menuItemId: { type: Types.ObjectId, ref: 'MenuItem', required: true }, quantity: { type: Number, required: true, min: 1 } }], default: [] })
  items: CartItem[];
}

export const CartSchema = SchemaFactory.createForClass(Cart);
