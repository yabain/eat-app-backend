import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type ChatUserDocument = HydratedDocument<ChatUser>;

export const CHAT_AVATAR_TTL_HOURS = 12;

/**
 * Avatar de chat (ChatUser) : identité éphémère qu'un client pose en scannant
 * le QR de la table. Les avatars non persistants expirent après 12 h — le TTL
 * Mongo supprime le document, mais PAS ses messages : la cascade est assurée
 * par le cron de purge du module chat (T17) et par la suppression manuelle
 * (DELETE /chat/avatars/:id).
 *
 * ⚠️ TTL : pour `isPersistant: true`, le champ `expiresAt` doit rester ABSENT
 * (jamais posé à null explicitement) — c'est la condition de non-expiration.
 */
@Schema({ timestamps: true })
export class ChatUser {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'TablePosition', required: true }) positionId: Types.ObjectId;
  /** Table du siège scanné — dénormalisée depuis la position à la création. */
  @Prop({ type: Types.ObjectId, ref: 'Table', required: true }) tableId: Types.ObjectId;
  /** Pseudo public : alphanumérique strict (pas de ponctuation/emoji). */
  @Prop({ required: true, match: /^[a-zA-Z0-9]+$/ }) pseudo: string;
  @Prop({ required: true, enum: ['M', 'F'] }) sex: 'M' | 'F';
  /** Photo de l'avatar : URL absolue ou chemin public /uploads/... */
  @Prop({ required: true }) photoUrl: string;
  @Prop({ enum: ['online', 'offline'], default: 'online' }) status: 'online' | 'offline';
  @Prop({ type: Object, default: () => ({}) }) socialUrls: {
    web?: string;
    facebook?: string;
    snapchat?: string;
    instagram?: string;
    tiktok?: string;
    linkedin?: string;
  };
  @Prop({ default: false }) isVerified: boolean;
  /** Persistant = ne porte PAS de expiresAt (champ absent) → jamais expiré. */
  @Prop({ default: false }) isPersistant: boolean;
  /** User authentifié propriétaire de l'avatar (tracé à la création). */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) userId?: Types.ObjectId | null;
  /** now + 12h pour les avatars non persistants. ABSENT si persistant. */
  @Prop() expiresAt?: Date;
}
export const ChatUserSchema = SchemaFactory.createForClass(ChatUser);
ChatUserSchema.index({ positionId: 1, status: 1 });
ChatUserSchema.index({ restaurantId: 1 });
ChatUserSchema.index({ tableId: 1 });
// TTL : supprime le document quand expiresAt est atteint. Les documents sans
// expiresAt (avatars persistants) ne sont jamais touchés par l'index TTL.
ChatUserSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
