import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  accountCreatedTemplate,
  deliveryAssignedTemplate,
  menuItemAvailableTemplate,
  orderConfirmedTemplate,
  orderDeliveredTemplate,
  orderStatusChangedTemplate,
  passwordChangedTemplate,
  restaurantOrderConfirmedTemplate,
  resetPasswordTemplate,
} from '../../common/email/templates';
import { MailTemplate } from '../../common/email/mail-layout';
import {
  accountCreatedWhatsappTemplate,
  deliveryAssignedWhatsappTemplate,
  deliveryStartedWhatsappTemplate,
  deliveryStartReminderWhatsappTemplate,
  menuItemAvailableWhatsappTemplate,
  orderConfirmedWhatsappTemplate,
  orderDeliveredWhatsappTemplate,
  orderStatusChangedWhatsappTemplate,
  passwordChangedWhatsappTemplate,
  restaurantPreparationReminderWhatsappTemplate,
  restaurantOrderConfirmedWhatsappTemplate,
  resetPasswordWhatsappTemplate,
} from '../../common/whatsapp/templates';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsappService: WhatsappService,
  ) {}

  sendAccountCreated(email: string | undefined, phone: string | undefined, input: { firstName?: string; loginUrl?: string }) {
    const template = accountCreatedTemplate(input);
    const whatsappText = accountCreatedWhatsappTemplate(input);
    this.dispatch('account_created', () => Promise.all([
      this.sendTemplate(email, template),
      this.sendWhatsapp(phone, whatsappText),
    ]));
  }

  sendResetPassword(email: string | undefined, phone: string | undefined, input: { resetLink: string; expiresIn?: string; firstName?: string; }) {
    const template = resetPasswordTemplate(input);
    const whatsappText = resetPasswordWhatsappTemplate(input);
    this.dispatch('reset_password', () => Promise.all([
      this.sendTemplate(email, template),
      this.sendWhatsapp(phone, whatsappText),
    ]));
  }

  sendPasswordChanged(email: string | undefined, phone: string | undefined, input: { firstName?: string; loginUrl?: string }) {
    const template = passwordChangedTemplate(input);
    const whatsappText = passwordChangedWhatsappTemplate(input);
    this.dispatch('password_changed', () => Promise.all([
      this.sendTemplate(email, template),
      this.sendWhatsapp(phone, whatsappText),
    ]));
  }

  async sendOrderConfirmed(email: string, phone: string, orderNumber: string) {
    const input = {
      orderNumber,
      orderUrl: this.buildOrderUrl(orderNumber),
    };
    this.dispatch(`order_confirmed:${orderNumber}`, () => Promise.all([
      this.sendTemplate(email, orderConfirmedTemplate(input)),
      this.sendWhatsapp(phone, orderConfirmedWhatsappTemplate(input)),
    ]));
    this.logger.log(`Notify confirmed order ${orderNumber} to ${email} / ${phone}`);
  }

  async sendRestaurantOrderConfirmed(recipients: Array<string | { email?: string; phone?: string }>, order: any) {
    const contacts = this.normalizeContacts(recipients);
    if (!contacts.length) return;

    const input = {
      orderNumber: order.orderNumber,
      restaurantName: order.restaurantName,
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      address: order.address,
      total: order.total,
      items: order.items,
      orderUrl: this.buildOpsOrderUrl(order.orderId),
    };
    const template = restaurantOrderConfirmedTemplate(input);
    const whatsappText = restaurantOrderConfirmedWhatsappTemplate(input);

    this.dispatch(`restaurant_order_confirmed:${order.orderNumber}`, () => Promise.all(
      contacts.flatMap((contact) => [
        this.sendTemplate(contact.email, template),
        this.sendWhatsapp(contact.phone, whatsappText),
      ]),
    ));
    this.logger.log(`Notify restaurant staff order ${order.orderNumber} to ${contacts.map((c) => c.email || c.phone).join(', ')}`);
  }

  async sendDeliveryAssigned(email: string | undefined, phone: string | undefined, order: any) {
    const input = {
      orderNumber: order.orderNumber,
      driverName: order.driverName,
      restaurantName: order.restaurantName,
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      address: order.address,
      total: order.total,
      orderUrl: this.buildDriverUrl(),
    };
    this.dispatch(`delivery_assigned:${order.orderNumber}`, () => Promise.all([
      this.sendTemplate(email, deliveryAssignedTemplate(input)),
      this.sendWhatsapp(phone, deliveryAssignedWhatsappTemplate(input)),
    ]));
    this.logger.log(`Notify delivery assignment ${order.orderNumber} to ${email || phone}`);
  }

  sendRestaurantPreparationReminder(
    recipients: Array<{ phone?: string }>,
    order: { orderId: string; orderNumber: string; restaurantName?: string; elapsedMinutes?: number },
  ) {
    const contacts = this.normalizeContacts(recipients);
    if (!contacts.length) return;
    const message = restaurantPreparationReminderWhatsappTemplate({
      ...order,
      orderUrl: this.buildOpsOrderUrl(order.orderId),
    });
    this.dispatch(`restaurant_preparation_reminder:${order.orderNumber}`, () => Promise.all(
      contacts.map((contact) => this.sendWhatsapp(contact.phone, message)),
    ));
  }

  sendDeliveryStartReminder(
    phone: string | undefined,
    input: {
      orderNumber: string;
      driverName?: string;
      restaurantName?: string;
      address?: string;
      elapsedMinutes?: number;
    },
  ) {
    this.dispatch(`delivery_start_reminder:${input.orderNumber}`, () => this.sendWhatsapp(
      phone,
      deliveryStartReminderWhatsappTemplate({
        ...input,
        orderUrl: this.buildDriverUrl(),
      }),
    ));
  }

  sendDeliveryStartedWhatsapp(phone: string | undefined, orderNumber: string) {
    this.dispatch(`delivery_started:${orderNumber}`, () => this.sendWhatsapp(
      phone,
      deliveryStartedWhatsappTemplate({
        orderNumber,
        orderUrl: this.buildOrderUrl(orderNumber),
      }),
    ));
  }

  async sendStatusChanged(email: string, phone: string, orderNumber: string, status: string) {
    const input = {
      orderNumber,
      status,
      orderUrl: this.buildOrderUrl(orderNumber),
    };
    this.dispatch(`order_status_changed:${orderNumber}`, () => Promise.all([
      this.sendTemplate(email, orderStatusChangedTemplate(input)),
      this.sendWhatsapp(phone, orderStatusChangedWhatsappTemplate(input)),
    ]));
    this.logger.log(`Notify order ${orderNumber} status ${status} to ${email} / ${phone}`);
  }

  async sendDelivered(email: string, phone: string, orderNumber: string) {
    const input = {
      orderNumber,
      orderUrl: this.buildOrderUrl(orderNumber),
    };
    this.dispatch(`order_delivered:${orderNumber}`, () => Promise.all([
      this.sendTemplate(email, orderDeliveredTemplate(input)),
      this.sendWhatsapp(phone, orderDeliveredWhatsappTemplate(input)),
    ]));
    this.logger.log(`Notify delivered order ${orderNumber} to ${email} / ${phone}`);
  }

  async sendMenuItemBackInStock(
    recipients: Array<{ email?: string; phone?: string; firstName?: string }>,
    input: { menuItemId: string; menuItemName: string; restaurantName?: string; restaurantId?: string },
  ) {
    if (!recipients?.length) return;
    const menuItemUrl = this.buildMenuItemUrl(input.menuItemId);
    for (const recipient of recipients) {
      const renderInput = {
        firstName: recipient.firstName,
        menuItemName: input.menuItemName,
        restaurantName: input.restaurantName,
        menuItemUrl,
      };
      const template = menuItemAvailableTemplate(renderInput);
      const whatsappText = menuItemAvailableWhatsappTemplate(renderInput);
      this.dispatch(`menu_item_available:${input.menuItemId}:${recipient.email || recipient.phone}`, () => Promise.all([
        this.sendTemplate(recipient.email, template),
        this.sendWhatsapp(recipient.phone, whatsappText),
      ]));
    }
    this.logger.log(
      `Notify ${recipients.length} favorite watcher(s) — menu item ${input.menuItemName} back in stock.`,
    );
  }

  async sendRawHtml(
    email: string | undefined,
    subject: string,
    html: string,
    attachment?: { path: string; filename?: string; contentType?: string },
  ) {
    await this.sendTemplate(email, { subject, html }, true, attachment);
  }

  private buildOrderUrl(orderNumber: string) {
    const frontendUrl = this.getFrontendUrl();
    if (!frontendUrl) return undefined;
    return `${frontendUrl}/orders/${encodeURIComponent(orderNumber)}`;
  }

  private buildOpsOrderUrl(orderId?: string) {
    const frontendUrl = this.getFrontendUrl();
    if (!frontendUrl || !orderId) return undefined;
    return `${frontendUrl}/manager/orders/${encodeURIComponent(orderId)}`;
  }

  private buildMenuItemUrl(menuItemId?: string) {
    const frontendUrl = this.getFrontendUrl();
    if (!frontendUrl || !menuItemId) return undefined;
    return `${frontendUrl}/menu-item/${encodeURIComponent(menuItemId)}`;
  }

  private buildDriverUrl() {
    const frontendUrl = this.getFrontendUrl();
    if (!frontendUrl) return undefined;
    return `${frontendUrl}/driver`;
  }

  private getFrontendUrl() {
    return this.normalizeUrl(this.configService.get<string>('FRONTEND_URL'));
  }

  buildPublicFrontendUrl() {
    return this.getFrontendUrl();
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

  private async sendTemplate(
    email: string | undefined,
    template: MailTemplate,
    throwOnFailure = false,
    attachment?: { path: string; filename?: string; contentType?: string },
  ) {
    if (!email) return;
    const mailer = this.createTransporter();
    if (!mailer) {
      this.logger.warn(`SMTP is not configured; skipped email "${template.subject}" to ${email}`);
      if (throwOnFailure) throw new Error('SMTP is not configured');
      return;
    }

    try {
      await mailer.transporter.sendMail({
        from: mailer.from,
        to: email,
        subject: template.subject,
        html: template.html,
        attachments: attachment
          ? [{
              path: attachment.path,
              filename: attachment.filename,
              contentType: attachment.contentType,
            }]
          : undefined,
      });
    } catch (error) {
      this.logger.warn(`Unable to send email "${template.subject}" to ${email}: ${error?.message || error}`);
      if (throwOnFailure) throw error;
    }
  }

  private async sendWhatsapp(phone: string | undefined, message: string) {
    if (!phone) return;
    try {
      await this.whatsappService.sendText(phone, message);
    } catch (error: any) {
      this.logger.warn(`Unable to send WhatsApp notification to ${phone}: ${error?.message || error}`);
    }
  }

  private dispatch(label: string, task: () => Promise<unknown>) {
    void Promise.resolve()
      .then(task)
      .catch((error: any) => {
        this.logger.warn(`Notification "${label}" failed: ${error?.message || error}`);
      });
  }

  private normalizeContacts(recipients: Array<string | { email?: string; phone?: string }> = []) {
    const map = new Map<string, { email?: string; phone?: string }>();
    for (const recipient of recipients) {
      const contact = typeof recipient === 'string'
        ? { email: recipient }
        : { email: recipient.email, phone: recipient.phone };
      const email = String(contact.email || '').trim().toLowerCase();
      const phone = String(contact.phone || '').replace(/\D/g, '');
      const key = email || phone;
      if (!key) continue;
      map.set(key, {
        email: email || undefined,
        phone: phone || undefined,
      });
    }
    return [...map.values()];
  }

  private normalizeUrl(url?: string) {
    const value = String(url || '').trim().replace(/\/+$/, '');
    if (!value) return undefined;
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }
}
