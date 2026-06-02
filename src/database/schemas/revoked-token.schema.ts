import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RevokedTokenDocument = HydratedDocument<RevokedToken>;

@Schema({ timestamps: true })
export class RevokedToken {
  @Prop({ required: true, unique: true })
  token: string;
}

export const RevokedTokenSchema = SchemaFactory.createForClass(RevokedToken);

RevokedTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
