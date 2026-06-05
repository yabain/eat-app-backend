import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VisitEvent, VisitEventSchema } from '../../database/schemas/visit-event.schema';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: VisitEvent.name, schema: VisitEventSchema }])],
  controllers: [TrackingController],
  providers: [TrackingService],
})
export class TrackingModule {}
