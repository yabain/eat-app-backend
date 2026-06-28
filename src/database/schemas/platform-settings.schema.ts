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
export class PlatformTestimonial {
  _id?: Types.ObjectId;

  @Prop({ required: true, trim: true }) name: string;
  @Prop({ default: '', trim: true }) profession?: string;
  @Prop({ default: '', trim: true }) photoUrl?: string;
  @Prop({ required: true, trim: true }) comment: string;
  @Prop({ default: 5, min: 1, max: 5 }) rating: number;
  @Prop({ default: true }) isActive: boolean;
  @Prop({ default: 0 }) order: number;
}

export const PlatformTestimonialSchema = SchemaFactory.createForClass(PlatformTestimonial);

@Schema({ _id: false })
export class PlatformOrderingSettings {
  @Prop({ default: 7, min: 0, max: 23 }) startHour: number;
  @Prop({ default: 24, min: 0, max: 24 }) endHour: number;
  @Prop({ default: 'Africa/Douala' }) timezone: string;
}

export const PlatformOrderingSettingsSchema = SchemaFactory.createForClass(PlatformOrderingSettings);

@Schema({ timestamps: true })
export class PlatformSettings {
  @Prop({ unique: true, default: 'public' }) key: string;

  @Prop({ type: PlatformContactSettingsSchema, default: {} })
  contact: PlatformContactSettings;

  @Prop({ type: PlatformOrderingSettingsSchema, default: () => ({}) })
  ordering: PlatformOrderingSettings;

  @Prop({ type: [PlatformSocialLinkSchema], default: [] })
  socialLinks: PlatformSocialLink[];

  @Prop({ type: [PlatformPartnerSchema], default: [] })
  partners: PlatformPartner[];

  @Prop({ type: [PlatformTestimonialSchema], default: [] })
  testimonials: PlatformTestimonial[];

  @Prop({ default: true })
  merlinEnabled: boolean;
}

export const PlatformSettingsSchema = SchemaFactory.createForClass(PlatformSettings);
