import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLog, AuditLogSchema } from '../../database/schemas/audit-log.schema';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogInterceptor } from '../../common/interceptors/audit-log.interceptor';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  controllers: [AuditLogsController],
  providers: [
    AuditLogsService,
    // Interceptor enregistré globalement : toutes les requêtes mutantes
    // (POST/PATCH/PUT/DELETE) seront automatiquement loguées.
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
