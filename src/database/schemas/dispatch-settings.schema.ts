import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DispatchSettingsDocument = HydratedDocument<DispatchSettings>;

@Schema({ timestamps: true })
export class DispatchSettings {
  @Prop({ unique: true, default: 'auto-dispatch' })
  key: string;

  @Prop({ default: false })
  enabled: boolean;

  @Prop({ default: null })
  lastRunAt?: Date | null;

  @Prop({ default: 0 })
  lastAssignedCount: number;
}

export const DispatchSettingsSchema = SchemaFactory.createForClass(DispatchSettings);
