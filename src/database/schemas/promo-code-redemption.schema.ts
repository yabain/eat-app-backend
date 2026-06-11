import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PromoCodeRedemptionDocument = HydratedDocument<PromoCodeRedemption>;

@Schema({ timestamps: true })
export class PromoCodeRedemption {
  @Prop({ type: Types.ObjectId, ref: 'PromoCode', required: true })
  promoCodeId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  orderId: Types.ObjectId;

  @Prop({ required: true, uppercase: true, trim: true })
  code: string;
}

export const PromoCodeRedemptionSchema = SchemaFactory.createForClass(PromoCodeRedemption);
PromoCodeRedemptionSchema.index({ promoCodeId: 1, userId: 1 }, { unique: true });
PromoCodeRedemptionSchema.index({ orderId: 1 }, { unique: true });
