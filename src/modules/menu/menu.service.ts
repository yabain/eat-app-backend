import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex, parseBooleanQuery } from '../../common/utils/search.util';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { MenuInventoryService } from './menu-inventory.service';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';

@Injectable()
export class MenuService {
  constructor(
    @InjectModel(MenuItem.name) private model: Model<MenuItemDocument>,
    private readonly inventory: MenuInventoryService,
  ) {}

  async findPublicByRestaurant(
    restaurantId: string,
    page?: number,
    limit?: number,
    filters?: { q?: string; categoryId?: string },
  ) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(filters?.q);
    const filter: any = { restaurantId, isActive: true, isAvailable: true };
    if (filters?.categoryId) filter.categoryId = filters.categoryId;
    if (qRegex) {
      filter.$or = [{ name: qRegex }, { description: qRegex }];
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

  async findAllForActor(
    actor: any,
    restaurantId?: string,
    page?: number,
    limit?: number,
    filters?: { q?: string; categoryId?: string; isAvailable?: string; isActive?: string },
  ) {
    const pagination = normalizePagination(page, limit);
    let filter: any = {};
    const qRegex = buildContainsRegex(filters?.q);
    if (actor.role === UserRole.ADMIN) {
      filter = restaurantId ? { restaurantId } : {};
    } else {
      if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
      filter = { restaurantId: actor.restaurantId };
    }
    if (filters?.categoryId) filter.categoryId = filters.categoryId;
    const isAvailable = parseBooleanQuery(filters?.isAvailable);
    const isActive = parseBooleanQuery(filters?.isActive);
    if (isAvailable !== undefined) filter.isAvailable = isAvailable;
    if (isActive !== undefined) filter.isActive = isActive;
    if (qRegex) filter.$or = [{ name: qRegex }, { description: qRegex }];

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

  async findOneForActor(actor: any, id: string) {
    const filter: any = { _id: id };
    if (actor.role !== UserRole.ADMIN) {
      if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
      filter.restaurantId = actor.restaurantId;
    }
    const item = await this.model.findOne(filter).populate('restaurantId').populate('categoryId');
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async findPublicOne(id: string) {
    const item = await this.model
      .findOne({ _id: id, isActive: true })
      .populate('restaurantId')
      .populate('categoryId');
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  createForActor(actor: any, dto: CreateMenuItemDto) {
    const payload = this.inventory.normalizeAvailabilityForStock(dto);
    if (actor.role === UserRole.ADMIN) {
      if (!payload.restaurantId) throw new BadRequestException('restaurantId is required for admin');
      return this.model.create(payload);
    }
    if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
    return this.model.create({ ...payload, restaurantId: actor.restaurantId });
  }

  async updateForActor(actor: any, id: string, dto: UpdateMenuItemDto) {
    const payload = this.inventory.normalizeAvailabilityForStock(dto);
    let filter: any = { _id: id };
    if (actor.role !== UserRole.ADMIN) {
      if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
      filter = { _id: id, restaurantId: actor.restaurantId };
      delete (payload as any).restaurantId;
    }
    const item = await this.model.findOneAndUpdate(filter, payload, { new: true });
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async removeForActor(actor: any, id: string) {
    let filter: any = { _id: id };
    if (actor.role !== UserRole.ADMIN) {
      if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
      filter = { _id: id, restaurantId: actor.restaurantId };
    }
    const item = await this.model.findOneAndDelete(filter);
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  activateForActor(actor: any, id: string) {
    return this.updateForActor(actor, id, { isActive: true } as UpdateMenuItemDto);
  }

  deactivateForActor(actor: any, id: string) {
    return this.updateForActor(actor, id, { isActive: false } as UpdateMenuItemDto);
  }
}
