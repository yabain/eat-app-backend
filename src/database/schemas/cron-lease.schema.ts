import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CronLeaseDocument = HydratedDocument<CronLease>;

/**
 * Lease lock distribué pour les crons multi-instances.
 *
 * Un cron acquiert un lease via un `findOneAndUpdate` atomique :
 *   filter = { name, expiresAt: { $lte: now } }
 *   update = { holder, expiresAt: now + ttlMs }
 *   upsert = true
 *
 * L'instance qui réussit l'upsert détient le lease pendant `ttlMs`.
 * Les autres instances voient `expiresAt > now` et skip le tick.
 */
@Schema({ timestamps: true })
export class CronLease {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  holder: string;

  @Prop({ required: true })
  expiresAt: Date;
}

export const CronLeaseSchema = SchemaFactory.createForClass(CronLease);
CronLeaseSchema.index({ name: 1 }, { unique: true });
