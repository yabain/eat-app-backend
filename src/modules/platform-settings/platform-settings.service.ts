import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../../database/schemas/platform-settings.schema';
import {
  CreatePartnerDto,
  CreateTestimonialDto,
  UpdatePartnerDto,
  UpdatePlatformSettingsDto,
  UpdateTestimonialDto,
} from './dto/platform-settings.dto';
import { currentHourInTz, isOrderingOpen } from '../../common/utils/ordering-window.util';

@Injectable()
export class PlatformSettingsService {
  private readonly settingsKey = 'public';

  constructor(
    @InjectModel(PlatformSettings.name) private readonly settingsModel: Model<PlatformSettingsDocument>,
  ) {}

  async getPublicSettings() {
    const settings = await this.getOrCreateSettings();
    return this.sortSettings(settings.toObject());
  }

  async updateSettings(dto: UpdatePlatformSettingsDto) {
    await this.getOrCreateSettings();
    const set: Record<string, unknown> = {};

    if (dto.contact) {
      if (dto.contact.supportPhone !== undefined) {
        set['contact.supportPhone'] = dto.contact.supportPhone || '';
      }
      if (dto.contact.supportWhatsapp !== undefined) {
        set['contact.supportWhatsapp'] = dto.contact.supportWhatsapp || '';
      }
      if (dto.contact.contactEmail !== undefined) {
        set['contact.contactEmail'] = dto.contact.contactEmail.trim().toLowerCase();
      }
      if (dto.contact.slogan !== undefined) {
        set['contact.slogan'] = dto.contact.slogan.trim();
      }
    }

    if (dto.ordering) {
      if (dto.ordering.startHour !== undefined) {
        const startHour = Math.max(0, Math.min(23, Math.floor(Number(dto.ordering.startHour))));
        if (!Number.isFinite(startHour)) throw new BadRequestException('startHour must be a number between 0 and 23');
        set['ordering.startHour'] = startHour;
      }
      if (dto.ordering.endHour !== undefined) {
        const endHour = Math.max(0, Math.min(24, Math.floor(Number(dto.ordering.endHour))));
        if (!Number.isFinite(endHour)) throw new BadRequestException('endHour must be a number between 0 and 24');
        set['ordering.endHour'] = endHour;
      }
      if (dto.ordering.timezone !== undefined) {
        const tz = String(dto.ordering.timezone || '').trim() || 'Africa/Douala';
        set['ordering.timezone'] = tz;
      }
    }

    if (dto.socialLinks) {
      set.socialLinks = dto.socialLinks.map((link, index) => ({
        name: (link.name || '').trim(),
        icon: (link.icon || '').trim(),
        url: (link.url || '').trim(),
        isActive: link.isActive ?? true,
        order: link.order ?? index,
      }));
    }

    const updated = await this.settingsModel.findOneAndUpdate(
      { key: this.settingsKey },
      { $set: set },
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException('Platform settings not found');
    return this.sortSettings(updated.toObject());
  }

  async addPartner(dto: CreatePartnerDto) {
    const settings = await this.getOrCreateSettings();
    settings.partners.push({
      _id: new Types.ObjectId(),
      name: dto.name,
      logoUrl: dto.logoUrl,
      websiteUrl: dto.websiteUrl || '',
      isActive: dto.isActive ?? true,
      order: dto.order ?? settings.partners.length,
    } as any);
    await settings.save();
    return this.sortSettings(settings.toObject());
  }

  async updatePartner(partnerId: string, dto: UpdatePartnerDto) {
    const settings = await this.getOrCreateSettings();
    const partner = settings.partners.find((item: any) => String(item._id) === String(partnerId)) as any;
    if (!partner) throw new NotFoundException('Partner not found');

    if (dto.name !== undefined) partner.name = dto.name;
    if (dto.logoUrl !== undefined) partner.logoUrl = dto.logoUrl;
    if (dto.websiteUrl !== undefined) partner.websiteUrl = dto.websiteUrl || '';
    if (dto.isActive !== undefined) partner.isActive = dto.isActive;
    if (dto.order !== undefined) partner.order = dto.order;

    await settings.save();
    return this.sortSettings(settings.toObject());
  }

  async deletePartner(partnerId: string) {
    const settings = await this.getOrCreateSettings();
    const initialLength = settings.partners.length;
    settings.partners = settings.partners.filter((item: any) => String(item._id) !== String(partnerId));
    if (settings.partners.length === initialLength) throw new NotFoundException('Partner not found');
    await settings.save();
    return this.sortSettings(settings.toObject());
  }

  async addTestimonial(dto: CreateTestimonialDto) {
    const settings = await this.getOrCreateSettings();
    settings.testimonials.push({
      _id: new Types.ObjectId(),
      name: dto.name,
      profession: dto.profession || '',
      photoUrl: dto.photoUrl || '',
      comment: dto.comment,
      rating: clampRating(dto.rating ?? 5),
      isActive: dto.isActive ?? true,
      order: dto.order ?? settings.testimonials.length,
    } as any);
    await settings.save();
    return this.sortSettings(settings.toObject());
  }

  async updateTestimonial(testimonialId: string, dto: UpdateTestimonialDto) {
    const settings = await this.getOrCreateSettings();
    const testimonial = settings.testimonials.find((item: any) => String(item._id) === String(testimonialId)) as any;
    if (!testimonial) throw new NotFoundException('Testimonial not found');

    if (dto.name !== undefined) testimonial.name = dto.name;
    if (dto.profession !== undefined) testimonial.profession = dto.profession || '';
    if (dto.photoUrl !== undefined) testimonial.photoUrl = dto.photoUrl || '';
    if (dto.comment !== undefined) testimonial.comment = dto.comment;
    if (dto.rating !== undefined) testimonial.rating = clampRating(dto.rating);
    if (dto.isActive !== undefined) testimonial.isActive = dto.isActive;
    if (dto.order !== undefined) testimonial.order = dto.order;

    await settings.save();
    return this.sortSettings(settings.toObject());
  }

  async deleteTestimonial(testimonialId: string) {
    const settings = await this.getOrCreateSettings();
    const initialLength = settings.testimonials.length;
    settings.testimonials = settings.testimonials.filter(
      (item: any) => String(item._id) !== String(testimonialId),
    );
    if (settings.testimonials.length === initialLength) throw new NotFoundException('Testimonial not found');
    await settings.save();
    return this.sortSettings(settings.toObject());
  }

  /**
   * Snapshot léger consommé par le frontend et par les vérifications backend
   * pour décider si on accepte une commande. Met en avant `isCurrentlyOpen`
   * calculé en temps réel à partir des heures configurées et du fuseau.
   */
  async getOrderingWindow() {
    const settings = await this.getOrCreateSettings();
    const ordering = (settings.toObject() as any).ordering || {};
    const startHour = clampHour(ordering.startHour, 7);
    const endHour = clampEnd(ordering.endHour, 24);
    const timezone = ordering.timezone || 'Africa/Douala';
    const now = new Date();
    return {
      startHour,
      endHour,
      timezone,
      isCurrentlyOpen: isOrderingOpen(startHour, endHour, timezone, now),
      currentHour: currentHourInTz(now, timezone),
      checkedAt: now.toISOString(),
    };
  }

  /**
   * Helper synchronisé pour les services backend qui doivent bloquer une
   * opération si on est hors période. Lance une BadRequestException dédiée.
   */
  async assertOrderingOpen(): Promise<void> {
    const window = await this.getOrderingWindow();
    if (!window.isCurrentlyOpen) {
      throw new BadRequestException(
        `Les commandes sont fermées en dehors des heures de service (${formatHourLabel(window.startHour)} - ${formatHourLabel(window.endHour)} ${window.timezone}).`,
      );
    }
  }

  private async getOrCreateSettings() {
    const existing = await this.settingsModel.findOne({ key: this.settingsKey });
    if (existing) return existing;

    return this.settingsModel.create({
      key: this.settingsKey,
      contact: {
        supportPhone: '',
        supportWhatsapp: '',
        contactEmail: '',
        slogan: '',
      },
      socialLinks: [
        { name: 'Facebook', icon: 'fa-brands fa-facebook-f', url: 'https://www.facebook.com/profile.php?id=61589331656629', isActive: true, order: 10 },
        { name: 'WhatsApp', icon: 'fa-brands fa-whatsapp', url: 'https://wa.me/237622478900', isActive: true, order: 20 },
        { name: 'LinkedIn', icon: 'fa-brands fa-linkedin', url: 'https://www.linkedin.com/company/eat-app-yabain', isActive: true, order: 30 },
        { name: 'Instagram', icon: 'fa-brands fa-instagram', url: '#', isActive: false, order: 40 },
      ],
      partners: [],
    });
  }

  private sortSettings(settings: any) {
    const sortByOrder = (items: any[] = []) =>
      [...items].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

    return {
      ...settings,
      socialLinks: sortByOrder(settings.socialLinks),
      partners: sortByOrder(settings.partners),
      testimonials: sortByOrder(settings.testimonials),
    };
  }
}

function clampRating(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function clampHour(value: any, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function clampEnd(value: any, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(24, Math.floor(n)));
}

function formatHourLabel(hour: number): string {
  const safe = Math.max(0, Math.min(24, Math.floor(Number(hour) || 0)));
  if (safe === 24) return '00h00';
  return `${String(safe).padStart(2, '0')}h00`;
}
