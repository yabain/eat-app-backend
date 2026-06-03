import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsappModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
