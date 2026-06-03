import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Prospect, ProspectDocument } from '../../database/schemas/prospect.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';
import { CreateProspectDto, UpdateProspectDto } from './dto/prospect.dto';

@Injectable()
export class ProspectsService {
  constructor(
    @InjectModel(Prospect.name) private readonly prospectModel: Model<ProspectDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async list(page?: number, limit?: number, q?: string) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(q);
    const filter: FilterQuery<ProspectDocument> = qRegex
      ? { $or: [{ name: qRegex }, { email: qRegex }, { phone: qRegex }] }
      : {};

    const [data, total] = await Promise.all([
      this.prospectModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
      this.prospectModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async create(dto: CreateProspectDto) {
    const payload = this.normalizePayload(dto);
    if (!payload.email && !payload.phone) {
      throw new BadRequestException('Email or phone is required');
    }

    await this.ensureNoMatchingUser(payload.email, payload.phone);
    await this.ensureNoDuplicateProspect(payload.email, payload.phone);
    return this.prospectModel.create(payload);
  }

  async update(id: string, dto: UpdateProspectDto) {
    const existing = await this.prospectModel.findById(id);
    if (!existing) throw new NotFoundException('Prospect not found');

    const payload = this.normalizePayload(dto);
    if (!payload.email && !payload.phone) {
      throw new BadRequestException('Email or phone is required');
    }

    await this.ensureNoMatchingUser(payload.email, payload.phone);
    await this.ensureNoDuplicateProspect(payload.email, payload.phone, id);

    const updated = await this.prospectModel.findByIdAndUpdate(id, payload, { new: true });
    if (!updated) throw new NotFoundException('Prospect not found');
    return updated;
  }

  async delete(id: string) {
    const deleted = await this.prospectModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Prospect not found');
    return deleted;
  }

  async removeMatchingUser(email?: string, phone?: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedPhone = this.normalizePhone(phone);
    const filters: any[] = [];
    if (normalizedEmail) filters.push({ email: normalizedEmail });
    if (normalizedPhone) filters.push({ phone: normalizedPhone });
    if (!filters.length) return;
    await this.prospectModel.deleteMany({ $or: filters });
  }

  async findAllRecipients() {
    return this.prospectModel.find({
      $or: [{ email: { $exists: true, $ne: '' } }, { phone: { $exists: true, $ne: '' } }],
    });
  }

  normalizePhone(phone?: string) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('237')) return digits.slice(3);
    return digits;
  }

  private normalizePayload(dto: CreateProspectDto | UpdateProspectDto) {
    return {
      name: String(dto.name || '').trim(),
      email: this.normalizeEmail(dto.email),
      phone: this.normalizePhone(dto.phone),
    };
  }

  private normalizeEmail(email?: string) {
    return String(email || '').trim().toLowerCase();
  }

  private async ensureNoMatchingUser(email?: string, phone?: string) {
    const filters: any[] = [];
    if (email) filters.push({ email });
    if (phone) {
      const phoneVariants = [phone, `237${phone}`];
      filters.push({ phone: { $in: phoneVariants } });
    }
    if (!filters.length) return;
    const existingUser = await this.userModel.exists({ $or: filters });
    if (existingUser) throw new BadRequestException('A user already exists with this email or phone');
  }

  private async ensureNoDuplicateProspect(email?: string, phone?: string, excludeId?: string) {
    const filters: any[] = [];
    if (email) filters.push({ email });
    if (phone) filters.push({ phone });
    if (!filters.length) return;
    const duplicate = await this.prospectModel.exists({
      $or: filters,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (duplicate) throw new BadRequestException('A prospect already exists with this email or phone');
  }
}
