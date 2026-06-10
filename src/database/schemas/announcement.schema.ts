import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AnnouncementDocument = HydratedDocument<Announcement>;

export enum AnnouncementRecipientGroup {
  ALL_USERS = 'all_users',
  ALL_MANAGERS = 'all_managers',
  ALL_DRIVERS = 'all_drivers',
  ALL_CLIENTS = 'all_clients',
  ALL_ADMINS = 'all_admins',
  ALL_PROSPECTS = 'all_prospects',
}

export enum AnnouncementStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
}

export enum AnnouncementChannel {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}

@Schema({ _id: false })
export class AnnouncementRecipientSnapshot {
  @Prop() email?: string;
  @Prop() phone?: string;
  @Prop() userId?: string;
  @Prop() userName?: string;
  @Prop() userFirstName?: string;
  @Prop() userLastName?: string;
  @Prop() userPhone?: string;
}

export const AnnouncementRecipientSnapshotSchema = SchemaFactory.createForClass(AnnouncementRecipientSnapshot);

@Schema({ timestamps: true })
export class Announcement {
  @Prop({ enum: Object.values(AnnouncementChannel), default: AnnouncementChannel.EMAIL })
  channel: AnnouncementChannel;

  @Prop({ required: true, trim: true }) subject: string;
  @Prop({ required: true }) html: string;
  @Prop({ default: null }) attachmentUrl?: string;
  @Prop({ default: null }) attachmentPath?: string;
  @Prop({ default: null }) attachmentName?: string;
  @Prop({ default: null }) attachmentMimeType?: string;
  @Prop({ default: 0 }) attachmentSize?: number;
  @Prop({ enum: Object.values(AnnouncementRecipientGroup), default: null }) recipientGroup?: AnnouncementRecipientGroup;
  @Prop({ type: [String], default: [] }) recipientEmails: string[];
  @Prop({ type: [String], default: [] }) recipientPhones: string[];
  @Prop({ required: true }) recipientLabel: string;
  @Prop({ enum: Object.values(AnnouncementStatus), default: AnnouncementStatus.DRAFT }) status: AnnouncementStatus;
  @Prop({ default: null }) scheduledAt?: Date;
  @Prop({ default: null }) sentAt?: Date;
  @Prop({ default: null }) failureReason?: string;
  @Prop({ default: 0 }) recipientCount: number;
  @Prop({ default: 0 }) successCount: number;
  @Prop({ default: 0 }) failureCount: number;
  @Prop({ type: [AnnouncementRecipientSnapshotSchema], default: [] }) recipientsSnapshot: AnnouncementRecipientSnapshot[];
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) createdBy?: Types.ObjectId;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
AnnouncementSchema.index({ status: 1, scheduledAt: 1 });
AnnouncementSchema.index({ createdAt: -1 });
