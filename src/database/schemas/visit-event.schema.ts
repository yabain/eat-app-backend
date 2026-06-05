import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VisitEventDocument = HydratedDocument<VisitEvent>;

export enum VisitActorType {
  VISITOR = 'visitor',
  CLIENT = 'client',
}

@Schema({ timestamps: true })
export class VisitEvent {
  @Prop({ required: true, trim: true })
  path: string;

  @Prop({ default: '' })
  title?: string;

  @Prop({ default: '' })
  sessionId?: string;

  @Prop({ enum: Object.values(VisitActorType), default: VisitActorType.VISITOR })
  actorType: VisitActorType;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId?: Types.ObjectId | null;

  @Prop({ default: '' })
  ip?: string;

  @Prop({ default: '' })
  userAgent?: string;
}

export const VisitEventSchema = SchemaFactory.createForClass(VisitEvent);
VisitEventSchema.index({ createdAt: -1 });
VisitEventSchema.index({ path: 1, createdAt: -1 });
VisitEventSchema.index({ actorType: 1, createdAt: -1 });
