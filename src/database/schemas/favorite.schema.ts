import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FavoriteDocument = HydratedDocument<Favorite>;

@Schema({ timestamps: true })
export class Favorite {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MenuItem', required: true })
  menuItemId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', default: null })
  restaurantId?: Types.ObjectId | null;

  /**
   * Snapshot du nom du plat à l'instant T pour rester affichable même après
   * suppression du MenuItem original.
   */
  @Prop({ default: '' })
  menuItemNameSnapshot: string;

  @Prop({ default: '' })
  restaurantNameSnapshot: string;

  /**
   * Mis à `true` quand le MenuItem référencé a été supprimé. Le favori reste
   * conservé pour l'historique mais s'affiche grisé côté client.
   */
  @Prop({ default: false })
  isMenuItemDeleted: boolean;
}

export const FavoriteSchema = SchemaFactory.createForClass(Favorite);
FavoriteSchema.index({ userId: 1, menuItemId: 1 }, { unique: true });
FavoriteSchema.index({ menuItemId: 1 });
FavoriteSchema.index({ userId: 1, createdAt: -1 });
