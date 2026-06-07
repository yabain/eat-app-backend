import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, SortOrder } from 'mongoose';
import * as XLSX from 'xlsx';
import { Prospect, ProspectDocument } from '../../database/schemas/prospect.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';
import { buildTimeSeriesStats } from '../../common/stats/time-series-stats';
import { buildExcelExport } from '../../common/utils/excel-export.util';
import { CreateProspectDto, UpdateProspectDto } from './dto/prospect.dto';

@Injectable()
export class ProspectsService {
  constructor(
    @InjectModel(Prospect.name) private readonly prospectModel: Model<ProspectDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async list(page?: number, limit?: number, q?: string, sorting?: { sortBy?: string; sortDir?: string }) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(q);
    const filter: FilterQuery<ProspectDocument> = qRegex
      ? { $or: [{ name: qRegex }, { email: qRegex }, { phone: qRegex }] }
      : {};

    const [data, total] = await Promise.all([
      this.prospectModel.find(filter).sort(this.buildSort(sorting?.sortBy, sorting?.sortDir)).skip(pagination.skip).limit(pagination.limit),
      this.prospectModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  private buildSort(sortBy?: string, sortDir?: string): Record<string, SortOrder> {
    const direction: SortOrder = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') return { name: direction, email: direction, phone: direction, createdAt: -1 };
    return { createdAt: direction };
  }

  stats(period?: string, date?: string) {
    return buildTimeSeriesStats(this.prospectModel, period, date);
  }

  async exportExcel() {
    const prospects = await this.prospectModel.find().sort({ createdAt: -1 }).lean();
    return buildExcelExport(
      prospects as unknown as Record<string, unknown>[],
      'Prospects',
    );
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

  async importExcel(buffer: Buffer) {
    if (!buffer?.length) throw new BadRequestException('Import file is required');

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new BadRequestException('Excel file has no sheet');

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], {
      defval: '',
      raw: false,
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let ignored = 0;

    for (const row of rows) {
      const payload = this.normalizeImportRow(row);
      if (!payload.email && !payload.phone) {
        ignored += 1;
        continue;
      }

      const existingUser = await this.findMatchingUser(payload.email, payload.phone);
      if (existingUser) {
        skipped += 1;
        continue;
      }

      const existingByEmail = payload.email ? await this.prospectModel.findOne({ email: payload.email }) : null;
      const existingByPhone = payload.phone ? await this.prospectModel.findOne({ phone: payload.phone }) : null;
      if (existingByEmail && existingByPhone && String(existingByEmail._id) !== String(existingByPhone._id)) {
        skipped += 1;
        continue;
      }

      const existing = existingByEmail || existingByPhone;
      if (existing) {
        const patch: Partial<Prospect> = {};
        if (!existing.name && payload.name) patch.name = payload.name;
        if (!existing.email && payload.email) patch.email = payload.email;
        if (!existing.phone && payload.phone) patch.phone = payload.phone;

        if (Object.keys(patch).length) {
          await this.prospectModel.updateOne({ _id: existing._id }, { $set: patch });
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      await this.prospectModel.create(payload);
      created += 1;
    }

    return {
      totalRows: rows.length,
      created,
      updated,
      skipped,
      ignored,
    };
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

  normalizeImportedPhone(phone?: string) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    const withoutCountry = digits.startsWith('237') ? digits.slice(3) : digits;
    const candidate = withoutCountry.length === 8 ? `6${withoutCountry}` : withoutCountry;
    return /^6\d{8}$/.test(candidate) ? candidate : '';
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

  private normalizeImportRow(row: Record<string, unknown>) {
    return {
      name: this.cell(row, 'name'),
      email: this.normalizeEmail(this.cell(row, 'email')),
      phone: this.normalizeImportedPhone(this.cell(row, 'phone')),
    };
  }

  private cell(row: Record<string, unknown>, column: string) {
    const key = Object.keys(row).find((item) => item.trim().toLowerCase() === column);
    return key ? String(row[key] || '').trim() : '';
  }

  private async ensureNoMatchingUser(email?: string, phone?: string) {
    const filters: any[] = [];
    if (email) filters.push({ email });
    if (phone) {
      const phoneVariants = [phone, `237${phone}`];
      filters.push({ phone: { $in: phoneVariants } });
    }
    if (!filters.length) return;
    const existingUser = await this.findMatchingUser(email, phone);
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

  private async findMatchingUser(email?: string, phone?: string) {
    const filters: any[] = [];
    if (email) filters.push({ email });
    if (phone) filters.push({ phone: { $in: [phone, `237${phone}`] } });
    if (!filters.length) return null;
    return this.userModel.exists({ $or: filters });
  }

}
