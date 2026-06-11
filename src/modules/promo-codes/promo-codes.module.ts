import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromoCode, PromoCodeSchema } from '../../database/schemas/promo-code.schema';
import { PromoCodesController } from './promo-codes.controller';
import { PromoCodesService } from './promo-codes.service';
import {
  PromoCodeRedemption,
  PromoCodeRedemptionSchema,
} from '../../database/schemas/promo-code-redemption.schema';

@Module({
  imports: [MongooseModule.forFeature([
    { name: PromoCode.name, schema: PromoCodeSchema },
    { name: PromoCodeRedemption.name, schema: PromoCodeRedemptionSchema },
  ])],
  providers: [PromoCodesService],
  controllers: [PromoCodesController],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
