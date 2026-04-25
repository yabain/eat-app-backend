import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromoCode, PromoCodeSchema } from '../../database/schemas/promo-code.schema';
import { PromoCodesController } from './promo-codes.controller';
import { PromoCodesService } from './promo-codes.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: PromoCode.name, schema: PromoCodeSchema }])],
  providers: [PromoCodesService],
  controllers: [PromoCodesController],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
