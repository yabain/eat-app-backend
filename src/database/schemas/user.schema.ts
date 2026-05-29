import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop() firstName?: string;
  @Prop() lastName?: string;
  @Prop({ required: true, unique: true, lowercase: true }) email: string;
  @Prop({ select: false }) passwordHash?: string;
  @Prop() phone?: string;
  @Prop() profileImage?: string;
  @Prop({ enum: Object.values(UserRole), default: UserRole.CLIENT }) role: UserRole;
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', default: null }) restaurantId?: Types.ObjectId;
  @Prop({ default: true }) isActive: boolean;
  @Prop({ default: true }) isDriverAvailable: boolean;
  @Prop({ enum: ['local', 'google'], default: 'local' }) authProvider: 'local' | 'google';
  @Prop({ unique: true, sparse: true }) googleId?: string;
  @Prop({ select: false }) passwordResetTokenHash?: string;
  @Prop({ select: false }) passwordResetExpiresAt?: Date;
  @Prop({ default: true }) isProfileComplete: boolean;
  /** Incrémenté au logout / reset password pour invalider les refresh tokens en cours. */
  @Prop({ default: 0 }) refreshTokenVersion: number;
}
export const UserSchema = SchemaFactory.createForClass(User);
