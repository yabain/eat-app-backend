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
import { CronLeaseService } from '../../common/cron-lease/cron-lease.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcement.dto';
import { basename, join } from 'path';
import { resolveUploadDir } from '../../common/utils/upload-dir.util';
import { deleteLocalUpload, deleteReplacedLocalUpload } from '../../common/utils/local-upload.util';

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);
  private readonly WAVE_SIZE = 10;
  private readonly WAVE_DELAY_MIN_SEC = 60;
  private readonly WAVE_DELAY_MAX_SEC = 300;
  private readonly PAUSE_MIN_MINUTES = 10;
  private readonly PAUSE_MAX_MINUTES = 30;
  private readonly MAX_WAVE_FAILURES = 5;
  private readonly DAILY_EMAIL_LIMIT = 1500;
  private readonly DAILY_WHATSAPP_LIMIT = 30;
  private readonly WHATSAPP_START_HOUR = 8;
  private readonly WHATSAPP_END_HOUR = 20;
  private readonly EMAIL_START_HOUR = 6;
  private readonly EMAIL_END_HOUR = 22;

  constructor(
    @InjectModel(Announcement.name) private readonly announcementModel: Model<AnnouncementDocument>,
    @InjectModel(AnnouncementDelivery.name) private readonly deliveryModel: Model<AnnouncementDeliveryDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly prospectsService: ProspectsService,
    private readonly whatsappService: WhatsappService,
    private readonly cronLease: CronLeaseService,
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
    this.validateAttachmentForChannel(channel, dto.attachmentMimeType);
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
      attachmentUrl: dto.attachmentUrl || null,
      attachmentPath: dto.attachmentPath || null,
      attachmentName: dto.attachmentName || null,
      attachmentMimeType: dto.attachmentMimeType || null,
      attachmentSize: Number(dto.attachmentSize || 0),
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
    const previousAttachmentPath = announcement.attachmentPath;

    if (dto.subject !== undefined) announcement.subject = dto.subject;
    if (dto.html !== undefined) announcement.html = dto.html;
    if (dto.channel !== undefined) announcement.channel = dto.channel;
    if (dto.attachmentUrl !== undefined) announcement.attachmentUrl = dto.attachmentUrl;
    if (dto.attachmentPath !== undefined) announcement.attachmentPath = dto.attachmentPath;
    if (dto.attachmentName !== undefined) announcement.attachmentName = dto.attachmentName;
    if (dto.attachmentMimeType !== undefined) announcement.attachmentMimeType = dto.attachmentMimeType;
    if (dto.attachmentSize !== undefined) announcement.attachmentSize = dto.attachmentSize;
    if (dto.recipientGroup !== undefined) announcement.recipientGroup = dto.recipientGroup;
    if (dto.recipientEmails !== undefined) announcement.recipientEmails = this.parseEmails(dto.recipientEmails);
    if (dto.recipientPhones !== undefined) announcement.recipientPhones = this.parsePhones(dto.recipientPhones);
    if (dto.scheduledAt !== undefined) announcement.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    if (!this.hasRecipientTarget(announcement.channel, announcement.recipientEmails, announcement.recipientPhones, announcement.recipientGroup)) {
      throw new BadRequestException('At least one recipient or recipient group is required');
    }
    this.validateAttachmentForChannel(announcement.channel, announcement.attachmentMimeType);

    announcement.recipientLabel = this.buildRecipientLabel(
      announcement.channel,
      announcement.recipientGroup,
      announcement.recipientEmails,
      announcement.recipientPhones,
    );
    announcement.status = announcement.scheduledAt ? AnnouncementStatus.SCHEDULED : AnnouncementStatus.DRAFT;
    const saved = await announcement.save();
    await deleteReplacedLocalUpload(previousAttachmentPath, saved.attachmentPath);
    return saved;
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
    announcement.currentWaveCount = 0;
    announcement.totalWaveFailures = 0;
    announcement.consecutiveFailures = 0;
    announcement.stoppedByFailure = false;
    announcement.nextProcessAt = new Date();
    announcement.recipientsSnapshot = recipients.slice(0, 100) as any[];
    return announcement.save();
  }

  async retryFailedDeliveries(id: string) {
    const announcement = await this.announcementModel.findById(id);
    if (!announcement) throw new NotFoundException('Announcement not found');
    if (announcement.status === AnnouncementStatus.SENDING) {
      throw new BadRequestException('Announcement delivery is still in progress');
    }

    const announcementId = announcement._id as Types.ObjectId;
    const toRetry = await this.deliveryModel.countDocuments({
      announcementId,
      status: { $in: [AnnouncementDeliveryStatus.FAILED, AnnouncementDeliveryStatus.PENDING] },
    });
    if (!toRetry) {
      throw new BadRequestException('No failed recipient to retry');
    }

    await this.deliveryModel.updateMany(
      {
        announcementId,
        status: { $in: [AnnouncementDeliveryStatus.FAILED, AnnouncementDeliveryStatus.PENDING] },
      },
      {
        $set: {
          status: AnnouncementDeliveryStatus.PENDING,
          attempts: 0,
          lastError: null,
          lockedAt: null,
          sentAt: null,
        },
      },
    );

    announcement.status = AnnouncementStatus.SENDING;
    announcement.sentAt = null;
    announcement.failureReason = null;
    announcement.stoppedByFailure = false;
    announcement.totalWaveFailures = 0;
    announcement.consecutiveFailures = 0;
    announcement.currentWaveCount = 0;
    announcement.nextProcessAt = new Date();
    await announcement.save();

    this.logger.log(
      `Retrying ${toRetry} delivery(ies) for announcement ${announcement._id}`,
    );
    return announcement;
  }

  async delete(id: string) {
    const announcement = await this.announcementModel.findByIdAndDelete(id);
    if (!announcement) throw new NotFoundException('Announcement not found');
    if (announcement.attachmentPath) await deleteLocalUpload(announcement.attachmentPath);
    return announcement;
  }

  buildAttachmentMetadata(file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attachment file is required');
    const relativePath = `/uploads/announcements/${file.filename}`;
    const appUrl = String(process.env.APP_URL || '').replace(/\/+$/, '');
    return {
      attachmentUrl: appUrl ? `${appUrl}${relativePath}` : relativePath,
      attachmentPath: relativePath,
      attachmentName: file.originalname,
      attachmentMimeType: file.mimetype,
      attachmentSize: file.size,
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sendScheduledAnnouncements() {
    if (!(await this.cronLease.acquire('announcements.sendScheduled', 50 * 1000))) return;
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

  @Cron('*/10 * * * * *')
  async processPendingDeliveries() {
    if (!(await this.cronLease.acquire('announcements.processPending', 9 * 1000))) return;
    try {
      await this.releaseStaleProcessingDeliveries();
      await this.processNextWaveDeliveries();
    } catch (error) {
      this.logger.warn(`Unable to process announcement deliveries: ${error?.message || error}`);
    }
  }

  private async processNextWaveDeliveries() {
    const now = new Date();
    const announcements = await this.announcementModel
      .find({
        status: AnnouncementStatus.SENDING,
        stoppedByFailure: false,
        nextProcessAt: { $lte: now },
      })
      .sort({ nextProcessAt: 1 })
      .limit(10);

    for (const announcement of announcements) {
      const dailyLimit = announcement.channel === AnnouncementChannel.WHATSAPP
        ? this.DAILY_WHATSAPP_LIMIT
        : this.DAILY_EMAIL_LIMIT;
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const sentToday = await this.deliveryModel.countDocuments({
        channel: announcement.channel,
        status: AnnouncementDeliveryStatus.SENT,
        sentAt: { $gte: startOfDay },
      });

      if (sentToday >= dailyLimit) {
        const nextDay = this.nextSendingWindow(announcement.channel);
        await this.announcementModel.updateOne(
          { _id: announcement._id },
          { $set: { nextProcessAt: nextDay, currentWaveCount: 0 } },
        );
        this.logger.log(
          `Daily ${announcement.channel} limit (${sentToday}/${dailyLimit}) reached for ` +
          `announcement ${announcement._id}, resuming ${nextDay.toISOString()}`,
        );
        continue;
      }

      if (!this.isWithinSendingHours(announcement.channel, now)) {
        const nextWindow = this.nextSendingWindow(announcement.channel);
        await this.announcementModel.updateOne(
          { _id: announcement._id },
          { $set: { nextProcessAt: nextWindow, currentWaveCount: 0 } },
        );
        this.logger.log(
          `Outside ${announcement.channel} sending hours for announcement ${announcement._id}, ` +
          `resuming at ${nextWindow.toISOString()}`,
        );
        continue;
      }

      const delivery = await this.deliveryModel.findOneAndUpdate(
        {
          announcementId: announcement._id,
          status: AnnouncementDeliveryStatus.PENDING,
        },
        {
          $set: { status: AnnouncementDeliveryStatus.PROCESSING, lockedAt: new Date() },
          $inc: { attempts: 1 },
        },
        { sort: { createdAt: 1 } },
      );
      if (!delivery) {
        // No pending deliveries left — check if all done
        const remaining = await this.deliveryModel.countDocuments({
          announcementId: announcement._id,
          status: { $in: [AnnouncementDeliveryStatus.PENDING, AnnouncementDeliveryStatus.PROCESSING] },
        });
        if (remaining === 0 && !announcement.stoppedByFailure) {
          await this.announcementModel.updateOne(
            { _id: announcement._id },
            { $set: { status: AnnouncementStatus.SENT, sentAt: now, nextProcessAt: null } },
          );
        }
        continue;
      }
      await this.processOneDeliveryForWave(delivery);
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

  private async processOneDeliveryForWave(delivery: AnnouncementDeliveryDocument) {
    const announcement = await this.announcementModel.findById(delivery.announcementId);
    if (!announcement) {
      await this.markDeliveryFailed(delivery, 'Annonce introuvable');
      return;
    }

    let success = false;
    try {
      const content = this.renderContent(announcement.html, delivery);
      const attachment = this.resolveAttachment(announcement);
      if (delivery.channel === AnnouncementChannel.WHATSAPP) {
        const message = this.withWhatsappFooter(this.addMessageVariation(this.stripHtml(content), delivery.recipientKey));
        if (attachment) {
          await this.whatsappService.sendMedia(delivery.phone, message, attachment);
        } else {
          await this.whatsappService.sendText(delivery.phone, message);
        }
      } else {
        const subjectPrefix = ['', '\u202F', '\u00A0'][this.simpleHash(delivery.recipientKey) % 3];
        await this.notificationsService.sendRawHtml(delivery.email, subjectPrefix + announcement.subject, content, attachment || undefined);
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
      success = true;
    } catch (error) {
      await this.markDeliveryFailed(delivery, error?.message || String(error));
    }

    await this.updateWaveProgress(String(delivery.announcementId), success, success ? undefined : delivery);
  }

  private async updateWaveProgress(announcementId: string, success: boolean, failedDelivery?: AnnouncementDeliveryDocument) {
    const ann = await this.announcementModel.findById(announcementId);
    if (!ann) return;

    const now = new Date();
    const update: Record<string, any> = {};

    if (success) {
      update.currentWaveCount = (ann.currentWaveCount || 0) + 1;
      update.consecutiveFailures = 0;

      const dailyLimit = ann.channel === AnnouncementChannel.WHATSAPP
        ? this.DAILY_WHATSAPP_LIMIT
        : this.DAILY_EMAIL_LIMIT;
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const sentToday = await this.deliveryModel.countDocuments({
        channel: ann.channel,
        status: AnnouncementDeliveryStatus.SENT,
        sentAt: { $gte: startOfDay },
      });

      if (sentToday >= dailyLimit) {
        const nextWindow = this.nextSendingWindow(ann.channel);
        update.nextProcessAt = nextWindow;
        update.currentWaveCount = 0;
        this.logger.log(
          `Daily ${ann.channel} limit (${sentToday}/${dailyLimit}) reached for ` +
          `announcement ${ann._id}, resuming ${nextWindow.toISOString()}`,
        );
      } else if (!this.isWithinSendingHours(ann.channel, now)) {
        const nextWindow = this.nextSendingWindow(ann.channel);
        update.nextProcessAt = nextWindow;
        update.currentWaveCount = 0;
        this.logger.log(
          `Outside ${ann.channel} sending hours for announcement ${ann._id}, ` +
          `resuming at ${nextWindow.toISOString()}`,
        );
      } else if (update.currentWaveCount >= this.jitteredWaveLimit()) {
        update.nextProcessAt = new Date(now.getTime() + this.randomInt(this.PAUSE_MIN_MINUTES, this.PAUSE_MAX_MINUTES) * 60 * 1000);
        update.currentWaveCount = 0;
      } else {
        update.nextProcessAt = new Date(now.getTime() + this.randomInt(this.WAVE_DELAY_MIN_SEC, this.WAVE_DELAY_MAX_SEC) * 1000);
      }
    } else {
      update.consecutiveFailures = (ann.consecutiveFailures || 0) + 1;
      update.totalWaveFailures = (ann.totalWaveFailures || 0) + 1;

      if (update.totalWaveFailures >= this.MAX_WAVE_FAILURES) {
        update.stoppedByFailure = true;
        update.status = AnnouncementStatus.FAILED;
        update.failureReason = `Envoi interrompu après ${this.MAX_WAVE_FAILURES} échecs`;
        update.nextProcessAt = null;
        void this.notifyAdminsOfFailure(ann, failedDelivery?.lastError || `${this.MAX_WAVE_FAILURES} échecs atteints`);
      } else {
        update.nextProcessAt = new Date(now.getTime() + this.randomInt(this.WAVE_DELAY_MIN_SEC, this.WAVE_DELAY_MAX_SEC) * 1000);
      }
    }

    // Count successes and check completion
    const [successCount, pendingCount] = await Promise.all([
      this.deliveryModel.countDocuments({ announcementId: new Types.ObjectId(announcementId), status: AnnouncementDeliveryStatus.SENT }),
      this.deliveryModel.countDocuments({
        announcementId: new Types.ObjectId(announcementId),
        status: { $in: [AnnouncementDeliveryStatus.PENDING, AnnouncementDeliveryStatus.PROCESSING] },
      }),
    ]);

    update.successCount = successCount;

    if (pendingCount === 0 && !ann.stoppedByFailure && !update.stoppedByFailure) {
      update.status = AnnouncementStatus.SENT;
      update.sentAt = now;
      update.nextProcessAt = null;
    }

    await this.announcementModel.updateOne({ _id: ann._id }, { $set: update });
  }

  resumeAnnouncementDelivery(id: string) {
    return this.retryFailedDeliveries(id);
  }

  private async notifyAdminsOfFailure(announcement: AnnouncementDocument, reason: string) {
    try {
      const admins = await this.userModel
        .find({ role: UserRole.ADMIN, isActive: { $ne: false } })
        .select('firstName lastName email phone')
        .limit(5);

      const subject = `Annonce interrompue: ${announcement.subject}`;
      const message = `L'envoi groupé "${announcement.subject}" (${announcement.channel}) a été interrompu après ${this.MAX_WAVE_FAILURES} échecs.\nDernière erreur: ${reason || 'Non spécifiée'}\nConnectez-vous pour relancer l'envoi.`;

      for (const admin of admins) {
        try {
          if (announcement.channel === AnnouncementChannel.WHATSAPP) {
            if (admin.email) {
              await this.notificationsService.sendRawHtml(admin.email, subject, message.replace(/\n/g, '<br>'));
            }
          } else if (admin.phone) {
            await this.whatsappService.sendText(admin.phone, message);
          }
        } catch {
          // Notification aux admins non bloquante
        }
      }
    } catch (error) {
      this.logger.warn(`Unable to notify admins of announcement failure: ${error?.message || error}`);
    }
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private sendingWindowStart(channel: AnnouncementChannel): number {
    return channel === AnnouncementChannel.WHATSAPP ? this.WHATSAPP_START_HOUR : this.EMAIL_START_HOUR;
  }

  private sendingWindowEnd(channel: AnnouncementChannel): number {
    return channel === AnnouncementChannel.WHATSAPP ? this.WHATSAPP_END_HOUR : this.EMAIL_END_HOUR;
  }

  private isWithinSendingHours(channel: AnnouncementChannel, now: Date): boolean {
    const hour = now.getHours();
    return hour >= this.sendingWindowStart(channel) && hour < this.sendingWindowEnd(channel);
  }

  private nextSendingWindow(channel: AnnouncementChannel): Date {
    const now = new Date();
    const start = this.sendingWindowStart(channel);
    const end = this.sendingWindowEnd(channel);
    const hour = now.getHours();
    if (hour < start) {
      const next = new Date(now);
      next.setHours(start, this.randomInt(0, 30), 0, 0);
      return next;
    }
    if (hour >= end) {
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(start, this.randomInt(0, 30), 0, 0);
      return next;
    }
    return now;
  }

  private jitteredWaveLimit(): number {
    return this.WAVE_SIZE + this.randomInt(-2, 5);
  }

  private addMessageVariation(message: string, recipientKey: string): string {
    const hash = this.simpleHash(recipientKey);
    const tweaks = [
      (m: string) => m,
      (m: string) => m + ' ',
      (m: string) => m.replace(/\n\n/g, '\n'),
      (m: string) => m.replace(/\.(\s|$)/g, '.\u00A0'),
      (m: string) => m.replace(/Eat App/g, 'Eat'),
    ];
    return tweaks[hash % tweaks.length](message);
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
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

  private validateAttachmentForChannel(channel: AnnouncementChannel, mimeType?: string | null) {
    if (!mimeType) return;
    if (channel === AnnouncementChannel.WHATSAPP && !mimeType.startsWith('image/')) {
      throw new BadRequestException('WhatsApp announcements only support image attachments');
    }
  }

  private resolveAttachment(announcement: AnnouncementDocument) {
    if (!announcement.attachmentPath) return null;
    return {
      path: join(resolveUploadDir('announcements'), basename(announcement.attachmentPath)),
      filename: announcement.attachmentName || basename(announcement.attachmentPath),
      contentType: announcement.attachmentMimeType || undefined,
    };
  }
}
