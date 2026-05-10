import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserRole } from '../../common/enums/roles.enum';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex } from '../../common/utils/search.util';
import { deleteLocalUpload, deleteReplacedLocalUpload } from '../../common/utils/local-upload.util';
import { AssignManagerDto } from './dto/assign-manager.dto';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantMediaDto } from './dto/update-restaurant-media.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectModel(Restaurant.name) private model: Model<RestaurantDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  private async validateManager(managerId?: string) {
    if (!managerId) return;
    const manager = await this.userModel.findById(managerId);
    if (!manager) throw new BadRequestException('Manager user not found');
    if (manager.role !== UserRole.MANAGER) throw new BadRequestException('Assigned managerId must reference a manager user');
  }

  private populateManager(query: any) {
    return query.populate({
      path: 'managerId',
      select: 'firstName lastName email phone role isActive profileImage restaurantId',
    });
  }

  async create(dto: CreateRestaurantDto) {
    await this.validateManager(dto.managerId);
    return this.model.create(dto);
  }

  async findAll(page?: number, limit?: number, filters?: { q?: string; status?: 'active' | 'inactive'; managerId?: string }) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(filters?.q);
    const filter: any = {};
    if (filters?.status) filter.status = filters.status;
    if (filters?.managerId) filter.managerId = filters.managerId;
    if (qRegex) {
      filter.$or = [
        { name: qRegex },
        { slug: qRegex },
        { description: qRegex },
        { email: qRegex },
        { phone: qRegex },
        { phone1: qRegex },
        { phone2: qRegex },
        { localisation: qRegex },
      ];
    }
    const [data, total] = await Promise.all([
      this.populateManager(this.model.find(filter))
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

  async findPublic(page?: number, limit?: number, q?: string) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(q);
    const filter: any = { status: 'active' as const };
    if (qRegex) {
      filter.$or = [
        { name: qRegex },
        { slug: qRegex },
        { description: qRegex },
        { localisation: qRegex },
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

  findOne(id: string) {
    return this.populateManager(this.model.findById(id));
  }

  findBySlug(slug: string) {
    return this.populateManager(this.model.findOne({ slug, status: 'active' }));
  }

  async findForStaff(actor: any) {
    if (!actor.restaurantId) throw new ForbiddenException('No restaurant assigned');
    const restaurant = await this.populateManager(this.model.findById(actor.restaurantId));
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    return restaurant;
  }

  async update(id: string, dto: UpdateRestaurantDto, actor?: any) {
    const existing = await this.model.findById(id);
    if (!existing) {
      await this.deleteNewMedia(dto);
      throw new NotFoundException('Restaurant not found');
    }
    if (actor?.role === UserRole.MANAGER) {
      if (actor.restaurantId?.toString() !== id) throw new ForbiddenException('You can only edit your own restaurant');
      delete dto.managerId;
      delete dto.status;
    } else {
      await this.validateManager(dto.managerId);
    }
    const item = await this.model.findByIdAndUpdate(id, dto, { new: true });
    if (!item) throw new NotFoundException('Restaurant not found');
    await this.deleteReplacedMedia(existing, dto);
    return item;
  }
  async activate(id: string) {
    const item = await this.model.findByIdAndUpdate(id, { status: 'active' }, { new: true });
    if (!item) throw new NotFoundException('Restaurant not found');
    return item;
  }
  async deactivate(id: string) {
    const item = await this.model.findByIdAndUpdate(id, { status: 'inactive' }, { new: true });
    if (!item) throw new NotFoundException('Restaurant not found');
    return item;
  }

  async assignManager(id: string, dto: AssignManagerDto) {
    await this.validateManager(dto.managerId);
    const item = await this.model.findByIdAndUpdate(id, { managerId: dto.managerId }, { new: true });
    if (!item) throw new NotFoundException('Restaurant not found');
    return item;
  }

  async updateMedia(id: string, dto: UpdateRestaurantMediaDto) {
    const existing = await this.model.findById(id);
    const updatePayload: any = { ...dto };
    if (dto.bannerImage && !dto.coverImage) updatePayload.coverImage = dto.bannerImage;
    if (!existing) {
      await this.deleteNewMedia(updatePayload);
      throw new NotFoundException('Restaurant not found');
    }
    const item = await this.model.findByIdAndUpdate(id, updatePayload, { new: true });
    if (!item) throw new NotFoundException('Restaurant not found');
    await this.deleteReplacedMedia(existing, updatePayload);
    return item;
  }

  async remove(id: string) {
    const item = await this.model.findByIdAndDelete(id);
    if (item) {
      await Promise.all([
        deleteLocalUpload(item.logo),
        deleteLocalUpload(item.bannerImage),
        deleteLocalUpload(item.coverImage),
      ]);
    }
    return item;
  }

  private async deleteReplacedMedia(previous: RestaurantDocument, next: { logo?: string; bannerImage?: string; coverImage?: string }) {
    await Promise.all([
      next.logo !== undefined ? deleteReplacedLocalUpload(previous.logo, next.logo) : Promise.resolve(),
      next.bannerImage !== undefined ? deleteReplacedLocalUpload(previous.bannerImage, next.bannerImage) : Promise.resolve(),
      next.coverImage !== undefined ? deleteReplacedLocalUpload(previous.coverImage, next.coverImage) : Promise.resolve(),
    ]);
  }

  private async deleteNewMedia(media: { logo?: string; bannerImage?: string; coverImage?: string }) {
    await Promise.all([
      deleteLocalUpload(media.logo),
      deleteLocalUpload(media.bannerImage),
      deleteLocalUpload(media.coverImage),
    ]);
  }
}
