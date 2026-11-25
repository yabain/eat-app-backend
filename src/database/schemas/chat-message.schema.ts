import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type ChatMessageDocument = HydratedDocument<ChatMessage>;

export const CHAT_MESSAGE_TTL_HOURS = 10;

/**
 * Message de chat de table : visible pendant 10 h (TTL Mongo + filtre
 * `expiresAt > now` dans la liste). toAvatarId null = message de groupe
 * (toute la table).
 */
@Schema({ timestamps: true })
export class ChatMessage {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  /** Table du chat (groupe + privés) — les positions ne portent plus les messages. */
  @Prop({ type: Types.ObjectId, ref: 'Table', required: true }) tableId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'ChatUser', required: true }) fromAvatarId: Types.ObjectId;
  /** null = message de groupe (toute la table). */
  @Prop({ type: Types.ObjectId, ref: 'ChatUser', default: null }) toAvatarId?: Types.ObjectId | null;
  @Prop({ required: true, maxlength: 1000 }) content: string;
  /** createdAt + 10h. TTL Mongo + filtre de liste. */
  @Prop({ required: true }) expiresAt: Date;
}
export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({ tableId: 1, createdAt: -1 });
ChatMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
