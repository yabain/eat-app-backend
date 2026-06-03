import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../../database/schemas/platform-settings.schema';
import { CreatePartnerDto, UpdatePartnerDto, UpdatePlatformSettingsDto } from './dto/platform-settings.dto';

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
    const settings = await this.getOrCreateSettings();
    const payload: any = {};

    if (dto.contact) {
      payload.contact = {
        ...(settings.contact || {}),
        ...dto.contact,
      };
    }

    if (dto.socialLinks) {
      payload.socialLinks = dto.socialLinks.map((link, index) => ({
        name: link.name || '',
        icon: link.icon || '',
        url: link.url || '',
        isActive: link.isActive ?? true,
        order: link.order ?? index,
      }));
    }

    const updated = await this.settingsModel.findOneAndUpdate(
      { key: this.settingsKey },
      { $set: payload },
      { new: true, upsert: true },
    );
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
        { name: 'WhatsApp', icon: 'fa-brands fa-whatsapp', url: 'https://wa.me/237620803178', isActive: true, order: 20 },
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
    };
  }
}
