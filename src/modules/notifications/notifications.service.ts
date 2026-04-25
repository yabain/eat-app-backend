import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async sendOrderConfirmed(email: string, phone: string, orderNumber: string) {
    this.logger.log(`Notify confirmed order ${orderNumber} to ${email} / ${phone}`);
  }

  async sendStatusChanged(email: string, phone: string, orderNumber: string, status: string) {
    this.logger.log(`Notify order ${orderNumber} status ${status} to ${email} / ${phone}`);
  }

  async sendDelivered(email: string, phone: string, orderNumber: string) {
    this.logger.log(`Notify delivered order ${orderNumber} to ${email} / ${phone}`);
  }
}
