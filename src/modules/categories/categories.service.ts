import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../../database/schemas/category.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex, parseBooleanQuery } from '../../common/utils/search.util';
import { deleteLocalUpload, deleteReplacedLocalUpload } from '../../common/utils/local-upload.util';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateAccompanimentDto, UpdateAccompanimentDto } from './dto/accompaniment.dto';

@Injectable()
export class CategoriesService {
  constructor(@InjectModel(Category.name) private model: Model<CategoryDocument>) {}
  async create(dto: CreateCategoryDto) {
    if (dto.isDefault === true) {
      await this.model.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }
    return this.model.create(dto);
  }
  async findOne(id: string) {
    const item = await this.model.findById(id);
    if (!item) throw new NotFoundException('Category not found');
    return item;
  }
  async findAll(page?: number, limit?: number, filters?: { q?: string; isActive?: string }) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(filters?.q);
    const filter: any = {};
    const isActive = parseBooleanQuery(filters?.isActive);
    if (isActive !== undefined) filter.isActive = isActive;
    if (qRegex) {
      filter.$or = [
        { name: qRegex },
        { description: qRegex },
      ];
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
  async update(id: string, dto: UpdateCategoryDto) {
    const existing = await this.model.findById(id);
    if (!existing) {
      await deleteLocalUpload(dto.image);
      throw new NotFoundException('Category not found');
    }
    if (dto.isDefault === true) {
      await this.model.updateMany({ _id: { $ne: id }, isDefault: true }, { $set: { isDefault: false } });
    }
    const item = await this.model.findByIdAndUpdate(id, dto, { new: true });
    if (!item) throw new NotFoundException('Category not found');
    if (dto.image !== undefined) await deleteReplacedLocalUpload(existing.image, dto.image);
    return item;
  }
  async updateImage(id: string, image: string) {
    const existing = await this.model.findById(id);
    if (!existing) {
      await deleteLocalUpload(image);
      throw new NotFoundException('Category not found');
    }
    const item = await this.model.findByIdAndUpdate(id, { image }, { new: true });
    if (!item) throw new NotFoundException('Category not found');
    await deleteReplacedLocalUpload(existing.image, image);
    return item;
  }
  async activate(id: string) {
    const item = await this.model.findByIdAndUpdate(id, { isActive: true }, { new: true });
    if (!item) throw new NotFoundException('Category not found');
    return item;
  }
  async deactivate(id: string) {
    const item = await this.model.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!item) throw new NotFoundException('Category not found');
    return item;
  }
  async remove(id: string) {
    const item = await this.model.findByIdAndDelete(id);
    if (item) await deleteLocalUpload(item.image);
    return item;
  }

  // ── Accompaniments ──────────────────────────────────────────────────────
  // Les accompagnements sont stockés en sous-documents de la catégorie. Chaque
  // sous-document a son propre _id ObjectId, utilisé comme référence stable
  // côté MenuItem.availableAccompanimentIds et côté Cart/Order.

  async addAccompaniment(categoryId: string, dto: CreateAccompanimentDto) {
    const category = await this.model.findById(categoryId);
    if (!category) throw new NotFoundException('Category not found');
    const sub: any = {
      _id: new Types.ObjectId(),
      name: dto.name.trim(),
      isActive: dto.isActive ?? true,
      order: dto.order ?? (category.accompaniments?.length || 0),
    };
    category.accompaniments.push(sub);
    await category.save();
    return category;
  }

  async updateAccompaniment(categoryId: string, accId: string, dto: UpdateAccompanimentDto) {
    const category = await this.model.findById(categoryId);
    if (!category) throw new NotFoundException('Category not found');
    const sub = (category.accompaniments || []).find((a: any) => String(a._id) === String(accId)) as any;
    if (!sub) throw new NotFoundException('Accompaniment not found');
    if (dto.name !== undefined) sub.name = dto.name.trim();
    if (dto.isActive !== undefined) sub.isActive = dto.isActive;
    if (dto.order !== undefined) sub.order = dto.order;
    await category.save();
    return category;
  }

  async deleteAccompaniment(categoryId: string, accId: string) {
    const category = await this.model.findById(categoryId);
    if (!category) throw new NotFoundException('Category not found');
    const initial = category.accompaniments.length;
    category.accompaniments = (category.accompaniments || []).filter(
      (a: any) => String(a._id) !== String(accId),
    ) as any;
    if (category.accompaniments.length === initial) {
      throw new NotFoundException('Accompaniment not found');
    }
    await category.save();
    return category;
  }
}
