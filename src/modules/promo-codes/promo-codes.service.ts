import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PromoCode, PromoCodeDocument } from '../../database/schemas/promo-code.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex, parseBooleanQuery } from '../../common/utils/search.util';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';

@Injectable()
export class PromoCodesService {
  constructor(@InjectModel(PromoCode.name) private model: Model<PromoCodeDocument>) {}
  create(dto: CreatePromoCodeDto) {
    return this.model.create({ ...dto, code: dto.code.toUpperCase() });
  }
  async findAll(
    page?: number,
    limit?: number,
    filters?: { q?: string; isActive?: string; code?: string; isExpired?: string },
  ) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(filters?.q);
    const filter: any = {};
    const isActive = parseBooleanQuery(filters?.isActive);
    const isExpired = parseBooleanQuery(filters?.isExpired);
    if (isActive !== undefined) filter.isActive = isActive;
    if (filters?.code) filter.code = filters.code.toUpperCase();
    if (qRegex) filter.code = qRegex;
    if (isExpired !== undefined) {
      if (isExpired) {
        filter.expirationDate = { $ne: null, $lt: new Date() };
      } else {
        filter.$or = [
          { expirationDate: null },
          { expirationDate: { $gte: new Date() } },
        ];
      }
    }
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
  async findOne(id: string) {
    const item = await this.model.findById(id);
    if (!item) throw new NotFoundException('Promo code not found');
    return item;
  }
  async validateCode(code: string, orderAmount: number, restaurantId?: string) {
    const promo = await this.model.findOne({ code: code.toUpperCase(), isActive: true });
    if (!promo) throw new NotFoundException('Promo code not found');
    if (promo.expirationDate && new Date(promo.expirationDate) < new Date()) throw new BadRequestException('Promo code expired');
    if (promo.usageLimit && promo.usedCount >= promo.usageLimit) throw new BadRequestException('Promo code usage limit reached');
    if (promo.minOrderAmount && orderAmount < promo.minOrderAmount) throw new BadRequestException('Order below minimum amount');
    if (restaurantId && promo.applicableRestaurantIds?.length) {
      const allowed = promo.applicableRestaurantIds.map((id:any)=>id.toString()).includes(restaurantId);
      if (!allowed) throw new BadRequestException('Promo code not valid for this restaurant');
    }
    return promo;
  }
  consume(promoId: string) { return this.model.findByIdAndUpdate(promoId, { $inc: { usedCount: 1 } }, { new: true }); }
  async update(id: string, dto: UpdatePromoCodeDto) {
    const item = await this.model.findByIdAndUpdate(id, dto, { new: true });
    if (!item) throw new NotFoundException('Promo code not found');
    return item;
  }
  async activate(id: string) {
    const item = await this.model.findByIdAndUpdate(id, { isActive: true }, { new: true });
    if (!item) throw new NotFoundException('Promo code not found');
    return item;
  }
  async deactivate(id: string) {
    const item = await this.model.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!item) throw new NotFoundException('Promo code not found');
    return item;
  }
  remove(id: string) { return this.model.findByIdAndDelete(id); }
}
