import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PlatformSettingsDocument = HydratedDocument<PlatformSettings>;

@Schema({ _id: false })
export class PlatformContactSettings {
  @Prop({ default: '' }) supportPhone?: string;
  @Prop({ default: '' }) supportWhatsapp?: string;
  @Prop({ default: '' }) contactEmail?: string;
  @Prop({ default: '' }) slogan?: string;
}

export const PlatformContactSettingsSchema = SchemaFactory.createForClass(PlatformContactSettings);

@Schema({ timestamps: false })
export class PlatformSocialLink {
  _id?: Types.ObjectId;

  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, trim: true }) icon: string;
  @Prop({ required: true, trim: true }) url: string;
  @Prop({ default: true }) isActive: boolean;
  @Prop({ default: 0 }) order: number;
}

export const PlatformSocialLinkSchema = SchemaFactory.createForClass(PlatformSocialLink);

@Schema({ timestamps: true })
export class PlatformPartner {
  _id?: Types.ObjectId;

  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, trim: true }) logoUrl: string;
  @Prop({ default: '', trim: true }) websiteUrl?: string;
  @Prop({ default: true }) isActive: boolean;
  @Prop({ default: 0 }) order: number;
}

export const PlatformPartnerSchema = SchemaFactory.createForClass(PlatformPartner);

@Schema({ timestamps: true })
export class PlatformSettings {
  @Prop({ unique: true, default: 'public' }) key: string;

  @Prop({ type: PlatformContactSettingsSchema, default: {} })
  contact: PlatformContactSettings;

  @Prop({ type: [PlatformSocialLinkSchema], default: [] })
  socialLinks: PlatformSocialLink[];

  @Prop({ type: [PlatformPartnerSchema], default: [] })
  partners: PlatformPartner[];
}

export const PlatformSettingsSchema = SchemaFactory.createForClass(PlatformSettings);
