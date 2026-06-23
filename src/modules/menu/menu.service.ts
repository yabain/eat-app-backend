import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, SortOrder, Types } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { Category, CategoryDocument } from '../../database/schemas/category.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex, parseBooleanQuery } from '../../common/utils/search.util';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { MenuInventoryService } from './menu-inventory.service';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { deleteLocalUpload, deleteReplacedLocalUpload } from '../../common/utils/local-upload.util';
import { FavoritesService } from '../favorites/favorites.service';

@Injectable()
export class MenuService {
  constructor(
    @InjectModel(MenuItem.name) private model: Model<MenuItemDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    private readonly inventory: MenuInventoryService,
    private readonly favorites: FavoritesService,
  ) {}

  private isSellable(item: { isAvailable?: boolean; isActive?: boolean; stock?: number } | null | undefined): boolean {
    if (!item) return false;
    return Boolean(item.isAvailable) && Boolean(item.isActive) && Number(item.stock || 0) > 0;
  }

  /**
   * Diagnostique chaque ligne du panier : retourne uniquement les entrées qui
   * posent problème (non trouvé / désactivé / stock insuffisant) avec leur
   * quantité disponible courante. Utilisé par la page panier pour afficher un
   * bandeau de pré-validation avant le checkout.
   */
  async stockCheck(
    items: Array<{ menuItemId: string; quantity: number }>,
  ): Promise<{
    items: Array<{
      menuItemId: string;
      name: string;
      requested: number;
      available: number;
      reason: 'unavailable' | 'insufficient';
    }>;
  }> {
    const issues: Array<{
      menuItemId: string;
      name: string;
      requested: number;
      available: number;
      reason: 'unavailable' | 'insufficient';
    }> = [];

    const validInputs = (items || []).filter(
      (entry) => entry && Types.ObjectId.isValid(entry.menuItemId) && Number(entry.quantity) > 0,
    );
    if (!validInputs.length) return { items: [] };

    const menuItems = await this.model
      .find({ _id: { $in: validInputs.map((entry) => new Types.ObjectId(entry.menuItemId)) } })
      .select({ _id: 1, name: 1, stock: 1, isAvailable: 1, isActive: 1 })
      .lean();

    const byId = new Map(menuItems.map((menu) => [String(menu._id), menu]));

    for (const entry of validInputs) {
      const menu = byId.get(entry.menuItemId);
      const requested = Number(entry.quantity);
      if (!menu) {
        issues.push({
          menuItemId: entry.menuItemId,
          name: 'Plat introuvable',
          requested,
          available: 0,
          reason: 'unavailable',
        });
        continue;
      }
      if (!menu.isActive || !menu.isAvailable || (menu.stock || 0) <= 0) {
        issues.push({
          menuItemId: entry.menuItemId,
          name: menu.name,
          requested,
          available: 0,
          reason: 'unavailable',
        });
        continue;
      }
      if ((menu.stock || 0) < requested) {
        issues.push({
          menuItemId: entry.menuItemId,
          name: menu.name,
          requested,
          available: Number(menu.stock || 0),
          reason: 'insufficient',
        });
      }
    }

    return { items: issues };
  }

  /**
   * Filtre les `availableAccompanimentIds` proposés pour ne garder que ceux
   * qui appartiennent réellement aux accompagnements de la catégorie cible.
   * Si la catégorie n'existe pas ou n'a pas d'accompagnements, on renvoie [].
   * Évite ainsi qu'un attaquant injecte des IDs arbitraires côté API.
   */
  private async sanitizeAccompanimentIds(
    categoryId: string | Types.ObjectId | undefined | null,
    ids: string[] | undefined,
  ): Promise<Types.ObjectId[] | undefined> {
    if (ids === undefined) return undefined; // pas demandé → laissé tel quel
    if (!Array.isArray(ids) || ids.length === 0) return [];
    if (!categoryId) throw new BadRequestException('categoryId is required when sending availableAccompanimentIds');

    const category = await this.categoryModel
      .findById(categoryId)
      .select({ accompaniments: 1 })
      .lean();
    if (!category) throw new BadRequestException('Category not found for accompaniments validation');

    const validIds = new Set(
      (category.accompaniments || []).map((a: any) => String(a._id)),
    );
    const unknown = ids.filter((id) => !validIds.has(String(id)));
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown accompaniment IDs for this category: ${unknown.join(', ')}`,
      );
    }
    return ids.map((id) => new Types.ObjectId(id));
  }

  private restaurantFilter(restaurantId: unknown) {
    const value = String(restaurantId || '');
    if (!Types.ObjectId.isValid(value)) return value;
    return { $in: [value, new Types.ObjectId(value)] };
  }

  async findPublicByRestaurant(
    restaurantId: string,
    page?: number,
    limit?: number,
    filters?: { q?: string; categoryId?: string },
  ) {
    const restaurant = await this.restaurantModel.exists({ _id: restaurantId, status: 'active' });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(filters?.q);
    const filter: any = {
      restaurantId: this.restaurantFilter(restaurantId),
      isActive: true,
      isAvailable: true,
    };
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
    filters?: { q?: string; categoryId?: string; isAvailable?: string; isActive?: string; sortBy?: string; sortDir?: string },
  ) {
    const pagination = normalizePagination(page, limit);
    let filter: any = {};
    const qRegex = buildContainsRegex(filters?.q);
    if (actor.role === UserRole.ADMIN) {
      filter = restaurantId ? { restaurantId: this.restaurantFilter(restaurantId) } : {};
    } else {
      if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
      filter = { restaurantId: this.restaurantFilter(actor.restaurantId) };
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
        .sort(this.buildSort(filters?.sortBy, filters?.sortDir))
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.model.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  private buildSort(sortBy?: string, sortDir?: string): Record<string, SortOrder> {
    const direction: SortOrder = sortDir === 'asc' ? 1 : -1;
    const sort: Record<string, SortOrder> = { isActive: -1, isAvailable: -1 };
    if (sortBy === 'name') sort.name = direction;
    else if (sortBy === 'createdAt') sort.createdAt = direction;
    else sort.name = 1;
    return sort;
  }

  async searchPublic(q?: string, page?: number, limit?: number) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(q);
    const activeRestaurants = await this.restaurantModel
      .find({ status: 'active' })
      .select('_id')
      .lean();
    const activeRestaurantIds = activeRestaurants.map((r) => r._id);

    if (!activeRestaurantIds.length) {
      return { data: [], meta: buildPaginationMeta(pagination.page, pagination.limit, 0) };
    }

    const filter: any = {
      restaurantId: { $in: activeRestaurantIds.flatMap((id: any) => [String(id), new Types.ObjectId(String(id))]) },
      isActive: true,
      isAvailable: true,
    };
    if (qRegex) {
      filter.$or = [{ name: qRegex }, { description: qRegex }];
    }

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('restaurantId', 'name slug logo')
        .populate('categoryId', 'name')
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
      filter.restaurantId = this.restaurantFilter(actor.restaurantId);
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
    if ((item.restaurantId as any)?.status !== 'active') throw new NotFoundException('Menu item not found');
    return item;
  }

  async createForActor(actor: any, dto: CreateMenuItemDto) {
    const payload: any = this.inventory.normalizeAvailabilityForStock(dto);

    // Validation des accompagnements proposés (doivent appartenir à la catégorie).
    const sanitized = await this.sanitizeAccompanimentIds(
      payload.categoryId,
      payload.availableAccompanimentIds,
    );
    if (sanitized !== undefined) payload.availableAccompanimentIds = sanitized;

    if (actor.role === UserRole.ADMIN) {
      if (!payload.restaurantId) throw new BadRequestException('restaurantId is required for admin');
      return this.model.create(payload);
    }
    if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
    return this.model.create({
      ...payload,
      restaurantId: actor.restaurantId,
      isActive: actor.role === UserRole.EMPLOYEE ? false : payload.isActive,
    });
  }

  async updateForActor(actor: any, id: string, dto: UpdateMenuItemDto) {
    const payload: any = this.inventory.normalizeAvailabilityForStock(dto);
    let filter: any = { _id: id };
    if (actor.role !== UserRole.ADMIN) {
      if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
      filter = { _id: id, restaurantId: this.restaurantFilter(actor.restaurantId) };
      delete (payload as any).restaurantId;
    }
    if (actor.role === UserRole.EMPLOYEE) {
      delete (payload as any).isActive;
    }
    const existing = await this.model.findOne(filter);
    if (!existing) {
      await deleteLocalUpload(payload.image);
      throw new NotFoundException('Menu item not found');
    }

    // Validation des accompagnements proposés : utilise la nouvelle catégorie
    // si elle change, sinon celle déjà liée au menu item.
    const targetCategoryId = payload.categoryId ?? existing.categoryId;
    const sanitized = await this.sanitizeAccompanimentIds(
      targetCategoryId as any,
      payload.availableAccompanimentIds,
    );
    if (sanitized !== undefined) payload.availableAccompanimentIds = sanitized;

    const wasSellable = this.isSellable(existing);

    const item = await this.model.findOneAndUpdate(filter, payload, { new: true });
    if (!item) throw new NotFoundException('Menu item not found');
    if (payload.image !== undefined) await deleteReplacedLocalUpload(existing.image, payload.image);

    if (!wasSellable && this.isSellable(item)) {
      void this.favorites.notifyBackInStock(String(item._id));
    }

    return item;
  }

  async removeForActor(actor: any, id: string) {
    let filter: any = { _id: id };
    if (actor.role !== UserRole.ADMIN) {
      if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
      filter = { _id: id, restaurantId: this.restaurantFilter(actor.restaurantId) };
    }
    const item = await this.model.findOneAndDelete(filter);
    if (!item) throw new NotFoundException('Menu item not found');
    await deleteLocalUpload(item.image);
    void this.favorites.markMenuItemDeleted(String(item._id));
    return item;
  }

  activateForActor(actor: any, id: string) {
    return this.updateForActor(actor, id, { isActive: true } as UpdateMenuItemDto);
  }

  deactivateForActor(actor: any, id: string) {
    return this.updateForActor(actor, id, { isActive: false } as UpdateMenuItemDto);
  }
}
