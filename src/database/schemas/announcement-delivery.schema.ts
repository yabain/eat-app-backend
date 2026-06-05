import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AnnouncementChannel } from './announcement.schema';

export type AnnouncementDeliveryDocument = HydratedDocument<AnnouncementDelivery>;

export enum AnnouncementDeliveryStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SENT = 'sent',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class AnnouncementDelivery {
  @Prop({ type: Types.ObjectId, ref: 'Announcement', required: true, index: true })
  announcementId: Types.ObjectId;

  @Prop({ enum: Object.values(AnnouncementChannel), required: true })
  channel: AnnouncementChannel;

  @Prop({ required: true })
  recipientKey: string;

  @Prop({ default: '' })
  email?: string;

  @Prop({ default: '' })
  phone?: string;

  @Prop({ default: '' })
  userId?: string;

  @Prop({ default: '' })
  userName?: string;

  @Prop({ default: '' })
  userFirstName?: string;

  @Prop({ default: '' })
  userLastName?: string;

  @Prop({ default: '' })
  userPhone?: string;

  @Prop({ enum: Object.values(AnnouncementDeliveryStatus), default: AnnouncementDeliveryStatus.PENDING, index: true })
  status: AnnouncementDeliveryStatus;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: null })
  lastError?: string;

  @Prop({ default: null })
  sentAt?: Date;

  @Prop({ default: null })
  lockedAt?: Date;
}

export const AnnouncementDeliverySchema = SchemaFactory.createForClass(AnnouncementDelivery);
AnnouncementDeliverySchema.index({ announcementId: 1, recipientKey: 1 }, { unique: true });
AnnouncementDeliverySchema.index({ status: 1, createdAt: 1 });
