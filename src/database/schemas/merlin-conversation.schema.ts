import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MerlinConversationDocument = HydratedDocument<MerlinConversation>;

export interface MerlinMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  visitorId?: string;
}

@Schema({ timestamps: true })
export class MerlinConversation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: false, index: true })
  userId?: Types.ObjectId;

  @Prop({ required: true, default: 'visitor' })
  role: string;

  @Prop({ required: false, index: true })
  visitorId?: string;

  @Prop({ required: false, index: true })
  visitorDate?: string;

  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: false })
  restaurantId?: Types.ObjectId;

  @Prop({
    type: [
      {
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        visitorId: { type: String, required: false },
      },
    ],
    default: [],
  })
  messages: { role: 'user' | 'assistant'; content: string; createdAt: Date; visitorId?: string }[];
}

export const MerlinConversationSchema = SchemaFactory.createForClass(MerlinConversation);