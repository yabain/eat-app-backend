import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CronLease, CronLeaseSchema } from '../../database/schemas/cron-lease.schema';
import { CronLeaseService } from './cron-lease.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: CronLease.name, schema: CronLeaseSchema }]),
  ],
  providers: [CronLeaseService],
  exports: [CronLeaseService],
})
export class CronLeaseModule {}
