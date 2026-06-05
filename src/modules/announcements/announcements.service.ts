import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AnnouncementDelivery,
  AnnouncementDeliveryDocument,
  AnnouncementDeliveryStatus,
} from '../../database/schemas/announcement-delivery.schema';
import {
  Announcement,
  AnnouncementChannel,
  AnnouncementDocument,
  AnnouncementRecipientGroup,
  AnnouncementStatus,
} from '../../database/schemas/announcement.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { UserRole } from '../../common/enums/roles.enum';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { NotificationsService } from '../notifications/notifications.service';
import { ProspectsService } from '../prospects/prospects.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcement.dto';

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);
  private processingDeliveries = false;

  constructor(
    @InjectModel(Announcement.name) private readonly announcementModel: Model<AnnouncementDocument>,
    @InjectModel(AnnouncementDelivery.name) private readonly deliveryModel: Model<AnnouncementDeliveryDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly prospectsService: ProspectsService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async list(page?: number, limit?: number, status?: AnnouncementStatus) {
    const pagination = normalizePagination(page, limit);
    const filter: FilterQuery<AnnouncementDocument> = {};
    if (status) filter.status = status;

    const [data, total] = await Promise.all([
      this.announcementModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.announcementModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async findOne(id: string) {
    const announcement = await this.announcementModel.findById(id);
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  async create(actor: any, dto: CreateAnnouncementDto, sendNow = false) {
    const channel = dto.channel || AnnouncementChannel.EMAIL;
    const recipientEmails = this.parseEmails(dto.recipientEmails);
    const recipientPhones = this.parsePhones(dto.recipientPhones);
    if (!this.hasRecipientTarget(channel, recipientEmails, recipientPhones, dto.recipientGroup)) {
      throw new BadRequestException('At least one recipient or recipient group is required');
    }

    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const status = sendNow
      ? AnnouncementStatus.DRAFT
      : scheduledAt
        ? AnnouncementStatus.SCHEDULED
        : AnnouncementStatus.DRAFT;

    const announcement = await this.announcementModel.create({
      channel,
      subject: dto.subject,
      html: dto.html,
      recipientGroup: dto.recipientGroup || null,
      recipientEmails,
      recipientPhones,
      recipientLabel: this.buildRecipientLabel(channel, dto.recipientGroup, recipientEmails, recipientPhones),
      status,
      scheduledAt,
      createdBy: actor?.sub || null,
    });

    if (sendNow) return this.sendAnnouncement(String(announcement._id));
    return announcement;
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    const announcement = await this.announcementModel.findById(id);
    if (!announcement) throw new NotFoundException('Announcement not found');
    if ([AnnouncementStatus.SENT, AnnouncementStatus.FAILED].includes(announcement.status)) {
      throw new BadRequestException('Only draft or scheduled announcements can be edited');
    }

    if (dto.subject !== undefined) announcement.subject = dto.subject;
    if (dto.html !== undefined) announcement.html = dto.html;
    if (dto.channel !== undefined) announcement.channel = dto.channel;
    if (dto.recipientGroup !== undefined) announcement.recipientGroup = dto.recipientGroup;
    if (dto.recipientEmails !== undefined) announcement.recipientEmails = this.parseEmails(dto.recipientEmails);
    if (dto.recipientPhones !== undefined) announcement.recipientPhones = this.parsePhones(dto.recipientPhones);
    if (dto.scheduledAt !== undefined) announcement.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    if (!this.hasRecipientTarget(announcement.channel, announcement.recipientEmails, announcement.recipientPhones, announcement.recipientGroup)) {
      throw new BadRequestException('At least one recipient or recipient group is required');
    }

    announcement.recipientLabel = this.buildRecipientLabel(
      announcement.channel,
      announcement.recipientGroup,
      announcement.recipientEmails,
      announcement.recipientPhones,
    );
    announcement.status = announcement.scheduledAt ? AnnouncementStatus.SCHEDULED : AnnouncementStatus.DRAFT;
    return announcement.save();
  }

  async sendAnnouncement(id: string) {
    const announcement = await this.announcementModel.findById(id);
    if (!announcement) throw new NotFoundException('Announcement not found');
    if ([AnnouncementStatus.SENT, AnnouncementStatus.SENDING].includes(announcement.status)) {
      throw new BadRequestException('Announcement already sent or sending');
    }

    const channel = announcement.channel || AnnouncementChannel.EMAIL;
    const recipients = await this.resolveRecipients(
      channel,
      announcement.recipientGroup,
      announcement.recipientEmails,
      announcement.recipientPhones,
    );
    if (!recipients.length) {
      announcement.status = AnnouncementStatus.FAILED;
      announcement.failureReason = 'No recipient resolved';
      announcement.recipientCount = 0;
      announcement.successCount = 0;
      announcement.failureCount = 0;
      await announcement.save();
      return announcement;
    }

    await this.enqueueDeliveries(announcement, channel, recipients);
    announcement.status = AnnouncementStatus.SENDING;
    announcement.sentAt = null;
    announcement.failureReason = null;
    announcement.recipientCount = recipients.length;
    announcement.successCount = 0;
    announcement.failureCount = 0;
    announcement.recipientsSnapshot = recipients.slice(0, 100) as any[];
    return announcement.save();
  }

  async delete(id: string) {
    const announcement = await this.announcementModel.findByIdAndDelete(id);
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sendScheduledAnnouncements() {
    const due = await this.announcementModel
      .find({
        status: AnnouncementStatus.SCHEDULED,
        scheduledAt: { $lte: new Date() },
      })
      .limit(10);

    for (const announcement of due) {
      try {
        await this.sendAnnouncement(String(announcement._id));
      } catch (error) {
        this.logger.warn(`Unable to send scheduled announcement ${announcement._id}: ${error?.message || error}`);
      }
    }
  }

  @Cron('*/15 * * * * *')
  async processPendingDeliveries() {
    if (this.processingDeliveries) return;
    this.processingDeliveries = true;
    try {
      await this.releaseStaleProcessingDeliveries();
      await this.processDeliveryBatch(AnnouncementChannel.EMAIL, Number(process.env.ANNOUNCEMENT_EMAIL_BATCH_SIZE || 100));
      await this.processDeliveryBatch(AnnouncementChannel.WHATSAPP, Number(process.env.ANNOUNCEMENT_WHATSAPP_BATCH_SIZE || 10));
    } catch (error) {
      this.logger.warn(`Unable to process announcement deliveries: ${error?.message || error}`);
    } finally {
      this.processingDeliveries = false;
    }
  }

  private async releaseStaleProcessingDeliveries() {
    const staleAfterMinutes = Number(process.env.ANNOUNCEMENT_DELIVERY_LOCK_TIMEOUT_MINUTES || 10);
    const staleBefore = new Date(Date.now() - Math.max(1, staleAfterMinutes) * 60_000);
    await this.deliveryModel.updateMany(
      {
        status: AnnouncementDeliveryStatus.PROCESSING,
        lockedAt: { $lte: staleBefore },
      },
      {
        $set: {
          status: AnnouncementDeliveryStatus.PENDING,
          lockedAt: null,
          lastError: 'Traitement interrompu, reprise automatique',
        },
      },
    );
  }

  private async enqueueDeliveries(announcement: AnnouncementDocument, channel: AnnouncementChannel, recipients: any[]) {
    const announcementId = announcement._id as Types.ObjectId;
    await this.deliveryModel.deleteMany({
      announcementId,
      status: { $in: [AnnouncementDeliveryStatus.PENDING, AnnouncementDeliveryStatus.PROCESSING, AnnouncementDeliveryStatus.FAILED] },
    });

    const deliveries = recipients.map((recipient) => {
      const email = recipient.email ? String(recipient.email).toLowerCase() : '';
      const phone = recipient.phone ? String(recipient.phone).replace(/\D/g, '') : '';
      const recipientKey = channel === AnnouncementChannel.WHATSAPP ? phone : email;
      return {
        announcementId,
        channel,
        recipientKey,
        email,
        phone,
        userId: recipient.userId || '',
        userName: recipient.userName || '',
        userFirstName: recipient.userFirstName || '',
        userLastName: recipient.userLastName || '',
        userPhone: recipient.userPhone || '',
        status: AnnouncementDeliveryStatus.PENDING,
        attempts: 0,
      };
    }).filter((delivery) => delivery.recipientKey);

    if (deliveries.length) {
      await this.deliveryModel.insertMany(deliveries, { ordered: false }).catch((error) => {
        if (error?.code !== 11000) throw error;
      });
    }
  }

  private async processDeliveryBatch(channel: AnnouncementChannel, limit: number) {
    const batchSize = Math.max(1, Math.min(500, Number(limit || 1)));
    const deliveries = await this.deliveryModel
      .find({
        channel,
        status: AnnouncementDeliveryStatus.PENDING,
      })
      .sort({ createdAt: 1 })
      .limit(batchSize);

    for (const delivery of deliveries) {
      const locked = await this.deliveryModel.findOneAndUpdate(
        { _id: delivery._id, status: AnnouncementDeliveryStatus.PENDING },
        {
          $set: { status: AnnouncementDeliveryStatus.PROCESSING, lockedAt: new Date() },
          $inc: { attempts: 1 },
        },
        { new: true },
      );
      if (!locked) continue;
      await this.processOneDelivery(locked);
    }
  }

  private async processOneDelivery(delivery: AnnouncementDeliveryDocument) {
    const announcement = await this.announcementModel.findById(delivery.announcementId);
    if (!announcement) {
      await this.markDeliveryFailed(delivery, 'Announcement not found');
      return;
    }

    try {
      const content = this.renderContent(announcement.html, delivery);
      if (delivery.channel === AnnouncementChannel.WHATSAPP) {
        await this.whatsappService.sendText(delivery.phone, this.withWhatsappFooter(this.stripHtml(content)));
      } else {
        await this.notificationsService.sendRawHtml(delivery.email, announcement.subject, content);
      }

      await this.deliveryModel.updateOne(
        { _id: delivery._id },
        {
          $set: {
            status: AnnouncementDeliveryStatus.SENT,
            sentAt: new Date(),
            lastError: null,
          },
        },
      );
    } catch (error) {
      await this.markDeliveryFailed(delivery, error?.message || String(error));
    }

    await this.refreshAnnouncementProgress(String(delivery.announcementId));
  }

  private async markDeliveryFailed(delivery: AnnouncementDeliveryDocument, message: string) {
    const maxAttempts = Number(process.env.ANNOUNCEMENT_DELIVERY_MAX_ATTEMPTS || 3);
    const nextStatus = delivery.attempts >= maxAttempts
      ? AnnouncementDeliveryStatus.FAILED
      : AnnouncementDeliveryStatus.PENDING;
    await this.deliveryModel.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: nextStatus,
          lastError: message.slice(0, 500),
          lockedAt: null,
        },
      },
    );
  }

  private async refreshAnnouncementProgress(announcementId: string) {
    const id = new Types.ObjectId(announcementId);
    const [successCount, failureCount, pendingCount, processingCount, failures] = await Promise.all([
      this.deliveryModel.countDocuments({ announcementId: id, status: AnnouncementDeliveryStatus.SENT }),
      this.deliveryModel.countDocuments({ announcementId: id, status: AnnouncementDeliveryStatus.FAILED }),
      this.deliveryModel.countDocuments({ announcementId: id, status: AnnouncementDeliveryStatus.PENDING }),
      this.deliveryModel.countDocuments({ announcementId: id, status: AnnouncementDeliveryStatus.PROCESSING }),
      this.deliveryModel
        .find({ announcementId: id, status: AnnouncementDeliveryStatus.FAILED })
        .sort({ updatedAt: -1 })
        .limit(10)
        .select('email phone lastError'),
    ]);

    const remaining = pendingCount + processingCount;
    const status = remaining > 0
      ? AnnouncementStatus.SENDING
      : successCount > 0
        ? AnnouncementStatus.SENT
        : AnnouncementStatus.FAILED;

    await this.announcementModel.updateOne(
      { _id: id },
      {
        $set: {
          status,
          sentAt: remaining > 0 ? null : new Date(),
          successCount,
          failureCount,
          failureReason: failures.map((item) => `${item.email || item.phone}: ${item.lastError}`).join('\n') || null,
        },
      },
    );
  }

  private parseEmails(raw?: string) {
    return [...new Set((raw || '')
      .split(/[;,]/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  }

  private parsePhones(raw?: string) {
    return [...new Set((raw || '')
      .split(/[;,]/)
      .map((phone) => phone.replace(/\D/g, ''))
      .filter((phone) => /^6\d{8}$/.test(phone)))];
  }

  private hasRecipientTarget(
    channel: AnnouncementChannel,
    emails: string[] = [],
    phones: string[] = [],
    group?: AnnouncementRecipientGroup,
  ) {
    if (group) return true;
    return channel === AnnouncementChannel.WHATSAPP ? phones.length > 0 : emails.length > 0;
  }

  private buildRecipientLabel(
    channel: AnnouncementChannel,
    group?: AnnouncementRecipientGroup,
    emails: string[] = [],
    phones: string[] = [],
  ) {
    const labels: string[] = [];
    if (group) labels.push(this.groupLabel(group));
    if (channel === AnnouncementChannel.WHATSAPP) {
      if (phones.length) labels.push(phones.length === 1 ? phones[0] : `${phones.length} numéros spécifiques`);
    } else if (emails.length) {
      labels.push(emails.length === 1 ? emails[0] : `${emails.length} adresses spécifiques`);
    }
    return labels.join(' + ');
  }

  private groupLabel(group: AnnouncementRecipientGroup) {
    const labels = {
      [AnnouncementRecipientGroup.ALL_USERS]: 'Tous users',
      [AnnouncementRecipientGroup.ALL_MANAGERS]: 'Tous Managers',
      [AnnouncementRecipientGroup.ALL_DRIVERS]: 'Tous drivers',
      [AnnouncementRecipientGroup.ALL_CLIENTS]: 'Tous Clients',
      [AnnouncementRecipientGroup.ALL_ADMINS]: 'Tous Admins',
      [AnnouncementRecipientGroup.ALL_PROSPECTS]: 'Tous Prospects',
    };
    return labels[group] || group;
  }

  private async resolveRecipients(
    channel: AnnouncementChannel,
    group?: AnnouncementRecipientGroup,
    emails: string[] = [],
    phones: string[] = [],
  ) {
    const recipientMap = new Map<string, any>();
    const addRecipient = (recipient: any) => {
      const key = channel === AnnouncementChannel.WHATSAPP
        ? String(recipient?.phone || '').replace(/\D/g, '')
        : String(recipient?.email || '').toLowerCase();
      if (!key) return;
      recipientMap.set(key, {
        email: recipient.email ? String(recipient.email).toLowerCase() : '',
        phone: recipient.phone ? String(recipient.phone).replace(/\D/g, '') : '',
        userId: recipient.userId || '',
        userName: recipient.userName || '',
        userFirstName: recipient.userFirstName || '',
        userLastName: recipient.userLastName || '',
        userPhone: recipient.userPhone || '',
      });
    };

    if (channel === AnnouncementChannel.WHATSAPP) {
      const explicitUsersByPhone = await this.findUsersByPhones(phones);
      for (const phone of phones) {
        addRecipient(this.buildRecipientFromUser(explicitUsersByPhone.get(phone)) || { phone });
      }
    } else {
      const explicitUsersByEmail = await this.findUsersByEmails(emails);
      for (const email of emails) {
        addRecipient(this.buildRecipientFromUser(explicitUsersByEmail.get(email)) || { email });
      }
    }

    if (group) {
      if (group === AnnouncementRecipientGroup.ALL_PROSPECTS) {
        const prospects = await this.prospectsService.findAllRecipients();
        for (const prospect of prospects) {
          const email = String(prospect.email || '').toLowerCase();
          const phone = prospect.phone ? `237${String(prospect.phone).replace(/\D/g, '')}` : '';
          addRecipient({
            email,
            phone,
            userName: prospect.name || 'Monsieur/Madame',
            userFirstName: prospect.name || '',
            userLastName: '',
            userPhone: phone,
          });
        }
        return [...recipientMap.values()];
      }

      const roleFilter = this.roleFilterForGroup(group);
      const users = await this.userModel
        .find({
          ...roleFilter,
          isActive: { $ne: false },
          ...(channel === AnnouncementChannel.WHATSAPP
            ? { phone: { $exists: true, $ne: '' } }
            : { email: { $exists: true, $ne: '' } }),
        })
        .select('firstName lastName email phone role');

      for (const user of users) {
        addRecipient(this.buildRecipientFromUser(user));
      }
    }

    return [...recipientMap.values()];
  }

  private async findUsersByEmails(emails: string[]) {
    const normalizedEmails = [...new Set(emails.map((email) => String(email).toLowerCase()))];
    if (!normalizedEmails.length) return new Map<string, UserDocument>();

    const users = await this.userModel
      .find({ email: { $in: normalizedEmails } })
      .select('firstName lastName email phone role');

    return new Map(users.map((user) => [String(user.email).toLowerCase(), user]));
  }

  private async findUsersByPhones(phones: string[]) {
    const normalizedPhones = [...new Set(phones.map((phone) => String(phone).replace(/\D/g, '')))];
    if (!normalizedPhones.length) return new Map<string, UserDocument>();

    const users = await this.userModel
      .find({ phone: { $exists: true, $ne: '' } })
      .select('firstName lastName email phone role');

    const map = new Map<string, UserDocument>();
    for (const user of users) {
      const variants = this.phoneVariants(user.phone || '');
      for (const phone of normalizedPhones) {
        if (variants.includes(phone)) map.set(phone, user);
      }
    }
    return map;
  }

  private buildRecipientFromUser(user?: UserDocument | null) {
    if (!user?.email && !user?.phone) return null;
    const firstName = user.firstName || '';
    const lastName = user.lastName || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    return {
      email: user.email ? String(user.email).toLowerCase() : '',
      phone: user.phone ? String(user.phone).replace(/\D/g, '') : '',
      userId: String(user._id),
      userName: fullName || user.email,
      userFirstName: firstName,
      userLastName: lastName,
      userPhone: user.phone || '',
    };
  }

  private roleFilterForGroup(group: AnnouncementRecipientGroup): FilterQuery<UserDocument> {
    if (group === AnnouncementRecipientGroup.ALL_USERS || group === AnnouncementRecipientGroup.ALL_PROSPECTS) return {};
    const roleByGroup = {
      [AnnouncementRecipientGroup.ALL_MANAGERS]: UserRole.MANAGER,
      [AnnouncementRecipientGroup.ALL_DRIVERS]: UserRole.DRIVER,
      [AnnouncementRecipientGroup.ALL_CLIENTS]: UserRole.CLIENT,
      [AnnouncementRecipientGroup.ALL_ADMINS]: UserRole.ADMIN,
    };
    return { role: roleByGroup[group] };
  }

  private phoneVariants(phone: string) {
    const digits = String(phone || '').replace(/\D/g, '');
    const variants = [digits];
    if (digits.startsWith('2376') && digits.length === 12) variants.push(`237${digits.slice(4)}`);
    if (digits.startsWith('6') && digits.length === 9) {
      variants.push(`237${digits}`);
      variants.push(`237${digits.slice(1)}`);
    }
    return [...new Set(variants.filter(Boolean))];
  }

  private renderContent(html: string, recipient: any) {
    const values = {
      userName: recipient.userName || 'Monsieur/Madame',
      userFirstName: recipient.userFirstName || '',
      userLastName: recipient.userLastName || '',
      userPhone: recipient.userPhone || '',
      userEmail: recipient.email || '',
    };

    return Object.entries(values).reduce(
      (content, [key, value]) => content.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
      html,
    );
  }

  private stripHtml(value: string) {
    return String(value || '')
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis, (_match, href, label) => {
        const cleanLabel = String(label || '').replace(/<[^>]+>/g, '').trim();
        const cleanHref = String(href || '').trim();
        return [cleanLabel, cleanHref].filter(Boolean).join('\n');
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  private withWhatsappFooter(message: string) {
    const footer = '> Ceci est un message automatique de Eat App';
    const content = String(message || '').trim();
    if (!content) return footer;
    if (content.includes(footer)) return content;
    return `${content}\n\n${footer}`;
  }
}
