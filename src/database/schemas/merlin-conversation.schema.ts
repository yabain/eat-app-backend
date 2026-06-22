import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MerlinConversationDocument = HydratedDocument<MerlinConversation>;

@Schema({ timestamps: true })
export class MerlinConversation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: false, index: true })
  userId?: Types.ObjectId;

  @Prop({ required: true, default: 'visitor' })
  role: string;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: false })
  restaurantId?: Types.ObjectId;

  @Prop({
    type: [
      {
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  messages: { role: 'user' | 'assistant'; content: string; createdAt: Date }[];
}

export const MerlinConversationSchema = SchemaFactory.createForClass(MerlinConversation);
