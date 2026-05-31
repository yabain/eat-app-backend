import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  deliveryAssignedTemplate,
  orderConfirmedTemplate,
  orderDeliveredTemplate,
  orderStatusChangedTemplate,
  restaurantOrderConfirmedTemplate,
} from '../../common/email/templates';
import { MailTemplate } from '../../common/email/mail-layout';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendOrderConfirmed(email: string, phone: string, orderNumber: string) {
    await this.sendTemplate(email, orderConfirmedTemplate({
      orderNumber,
      orderUrl: this.buildOrderUrl(orderNumber),
    }));
    this.logger.log(`Notify confirmed order ${orderNumber} to ${email} / ${phone}`);
  }

  async sendRestaurantOrderConfirmed(recipients: string[], order: any) {
    const emails = [...new Set((recipients || []).filter(Boolean))];
    if (!emails.length) return;

    const template = restaurantOrderConfirmedTemplate({
      orderNumber: order.orderNumber,
      restaurantName: order.restaurantName,
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      address: order.address,
      total: order.total,
      items: order.items,
      orderUrl: this.buildOpsOrderUrl(order.orderId),
    });

    await Promise.all(emails.map((email) => this.sendTemplate(email, template)));
    this.logger.log(`Notify restaurant staff order ${order.orderNumber} to ${emails.join(', ')}`);
  }

  async sendDeliveryAssigned(email: string | undefined, order: any) {
    await this.sendTemplate(email, deliveryAssignedTemplate({
      orderNumber: order.orderNumber,
      driverName: order.driverName,
      restaurantName: order.restaurantName,
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      address: order.address,
      total: order.total,
      orderUrl: this.buildDriverUrl(),
    }));
    this.logger.log(`Notify delivery assignment ${order.orderNumber} to ${email}`);
  }

  async sendStatusChanged(email: string, phone: string, orderNumber: string, status: string) {
    await this.sendTemplate(email, orderStatusChangedTemplate({
      orderNumber,
      status,
      orderUrl: this.buildOrderUrl(orderNumber),
    }));
    this.logger.log(`Notify order ${orderNumber} status ${status} to ${email} / ${phone}`);
  }

  async sendDelivered(email: string, phone: string, orderNumber: string) {
    await this.sendTemplate(email, orderDeliveredTemplate({
      orderNumber,
      orderUrl: this.buildOrderUrl(orderNumber),
    }));
    this.logger.log(`Notify delivered order ${orderNumber} to ${email} / ${phone}`);
  }

  private buildOrderUrl(orderNumber: string) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.replace(/\/+$/, '');
    if (!frontendUrl) return undefined;
    return `${frontendUrl}/orders/${encodeURIComponent(orderNumber)}`;
  }

  private buildOpsOrderUrl(orderId?: string) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.replace(/\/+$/, '');
    if (!frontendUrl || !orderId) return undefined;
    return `${frontendUrl}/manager/orders/${encodeURIComponent(orderId)}`;
  }

  private buildDriverUrl() {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.replace(/\/+$/, '');
    if (!frontendUrl) return undefined;
    return `${frontendUrl}/driver`;
  }

  private createTransporter() {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = Number(this.configService.get<string>('SMTP_PORT'));
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) return null;

    return {
      from: smtpUser,
      transporter: nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      }),
    };
  }

  private async sendTemplate(email: string | undefined, template: MailTemplate) {
    if (!email) return;
    const mailer = this.createTransporter();
    if (!mailer) {
      this.logger.warn(`SMTP is not configured; skipped email "${template.subject}" to ${email}`);
      return;
    }

    try {
      await mailer.transporter.sendMail({
        from: mailer.from,
        to: email,
        subject: template.subject,
        html: template.html,
      });
    } catch (error) {
      this.logger.warn(`Unable to send email "${template.subject}" to ${email}: ${error?.message || error}`);
    }
  }
}
