import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BalanceDocument = HydratedDocument<Balance>;
export type BalanceAccountType = 'driver' | 'restaurant' | 'system';

function toInteger(value: unknown): number {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(amount));
}

@Schema({ timestamps: true })
export class Balance {
  @Prop({ enum: ['driver', 'restaurant', 'system'], required: true })
  accountType: BalanceAccountType;

  @Prop({ required: true })
  ownerId: string;

  @Prop({ required: true, default: 0, set: toInteger })
  balance: number;

  @Prop({ default: 'XAF' })
  currency: string;
}

export const BalanceSchema = SchemaFactory.createForClass(Balance);
BalanceSchema.index({ accountType: 1, ownerId: 1 }, { unique: true });
