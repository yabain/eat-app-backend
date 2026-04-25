import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeliveryZone, DeliveryZoneSchema } from '../../database/schemas/delivery-zone.schema';
import { DeliveryZonesController } from './delivery-zones.controller';
import { DeliveryZonesService } from './delivery-zones.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: DeliveryZone.name, schema: DeliveryZoneSchema }])],
  providers: [DeliveryZonesService],
  controllers: [DeliveryZonesController],
  exports: [DeliveryZonesService],
})
export class DeliveryZonesModule {}
