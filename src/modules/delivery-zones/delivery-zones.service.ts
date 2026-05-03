import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeliveryZone, DeliveryZoneDocument } from '../../database/schemas/delivery-zone.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex, escapeRegex, parseBooleanQuery } from '../../common/utils/search.util';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';

@Injectable()
export class DeliveryZonesService {
  constructor(@InjectModel(DeliveryZone.name) private model: Model<DeliveryZoneDocument>) {}
  create(dto: CreateDeliveryZoneDto) { return this.model.create(dto); }
  async findOne(id: string) {
    const item = await this.model.findById(id);
    if (!item) throw new NotFoundException('Delivery zone not found');
    return item;
  }
  async findAll(page?: number, limit?: number, filters?: { q?: string; city?: string; district?: string; isActive?: string }) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(filters?.q);
    const filter: any = {};
    if (filters?.city) filter.city = new RegExp(`^${escapeRegex(filters.city)}$`, 'i');
    if (filters?.district) filter.district = new RegExp(`^${escapeRegex(filters.district)}$`, 'i');
    const isActive = parseBooleanQuery(filters?.isActive);
    if (isActive !== undefined) filter.isActive = isActive;
    if (qRegex) filter.$or = [{ city: qRegex }, { district: qRegex }, { details: qRegex }];
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.model.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }
  async findActive(page?: number, limit?: number, q?: string) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(q);
    const filter: any = { isActive: true };
    if (qRegex) filter.$or = [{ city: qRegex }, { district: qRegex }, { details: qRegex }];
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.model.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }
  findByCity(city: string) { return this.model.find({ city, isActive: true }); }
  async findByCityDistrict(city: string, district: string) {
    const zone = await this.model.findOne({ city, district, isActive: true });
    if (!zone) throw new NotFoundException('Delivery zone not found');
    return zone;
  }
  async update(id: string, dto: UpdateDeliveryZoneDto) {
    const item = await this.model.findByIdAndUpdate(id, dto, { new: true });
    if (!item) throw new NotFoundException('Delivery zone not found');
    return item;
  }
  async activate(id: string) {
    const item = await this.model.findByIdAndUpdate(id, { isActive: true }, { new: true });
    if (!item) throw new NotFoundException('Delivery zone not found');
    return item;
  }
  async deactivate(id: string) {
    const item = await this.model.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!item) throw new NotFoundException('Delivery zone not found');
    return item;
  }
  remove(id: string) { return this.model.findByIdAndDelete(id); }
}
