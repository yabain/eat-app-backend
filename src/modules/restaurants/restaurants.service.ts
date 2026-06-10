import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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

  private async assertCanManageTeam(restaurantId: string, actor: any) {
    const restaurant = await this.model.findById(restaurantId);
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    if (actor.role === UserRole.ADMIN) return restaurant;
    if (actor.role !== UserRole.MANAGER || String(actor.restaurantId || '') !== restaurantId) {
      throw new ForbiddenException('You can only manage employees from your restaurant');
    }
    return restaurant;
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
      this.model.aggregate([
        { $match: filter },
        { $addFields: { displayOrder: { $ifNull: ['$order', 9999] } } },
        { $sort: { displayOrder: 1, createdAt: -1 } },
        { $skip: pagination.skip },
        { $limit: pagination.limit },
        {
          $lookup: {
            from: 'menuitems',
            let: { restaurantId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [
                      { $toString: '$restaurantId' },
                      { $toString: '$$restaurantId' },
                    ],
                  },
                  isActive: true,
                  isAvailable: true,
                  stock: { $gt: 0 },
                },
              },
              { $limit: 1 },
              { $project: { _id: 1 } },
            ],
            as: 'availableMenuItems',
          },
        },
        { $addFields: { hasAvailableItems: { $gt: [{ $size: '$availableMenuItems' }, 0] } } },
        { $project: { displayOrder: 0, availableMenuItems: 0 } },
      ]),
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
      delete dto.order;
      delete dto.top;
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
    const restaurant = await this.model.findById(id);
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    const nextManager = await this.userModel.findById(dto.managerId);
    if (!nextManager) throw new BadRequestException('Manager user not found');
    if (![UserRole.CLIENT, UserRole.MANAGER].includes(nextManager.role)) {
      throw new BadRequestException('Only a client or manager account can become restaurant manager');
    }
    if (nextManager.isActive === false) {
      throw new BadRequestException('The selected user account is inactive');
    }
    const previousManagerId = restaurant.managerId ? String(restaurant.managerId) : '';

    if (nextManager.restaurantId && String(nextManager.restaurantId) !== id) {
      throw new BadRequestException('User is already assigned to another restaurant');
    }

    restaurant.managerId = new Types.ObjectId(dto.managerId);
    nextManager.role = UserRole.MANAGER;
    nextManager.restaurantId = new Types.ObjectId(id);
    nextManager.refreshTokenVersion = Number(nextManager.refreshTokenVersion || 0) + 1;
    await Promise.all([
      restaurant.save(),
      nextManager.save(),
      previousManagerId && previousManagerId !== dto.managerId
        ? this.userModel.updateOne(
            { _id: previousManagerId, restaurantId: restaurant._id },
            {
              $set: { restaurantId: null, role: UserRole.CLIENT },
              $inc: { refreshTokenVersion: 1 },
            },
          )
        : Promise.resolve(),
    ]);

    return this.populateManager(this.model.findById(id));
  }

  async removeManager(id: string) {
    const restaurant = await this.model.findById(id);
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    const managerId = restaurant.managerId ? String(restaurant.managerId) : '';
    if (!managerId) throw new BadRequestException('Restaurant has no assigned manager');

    restaurant.managerId = null as any;
    await Promise.all([
      restaurant.save(),
      this.userModel.updateOne(
        { _id: managerId, restaurantId: restaurant._id },
        {
          $set: { restaurantId: null, role: UserRole.CLIENT },
          $inc: { refreshTokenVersion: 1 },
        },
      ),
    ]);
    return this.populateManager(this.model.findById(id));
  }

  async listEmployees(id: string, actor: any, page?: number, limit?: number, q?: string) {
    await this.assertCanManageTeam(id, actor);
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(q);
    const filter: any = {
      restaurantId: new Types.ObjectId(id),
      role: UserRole.EMPLOYEE,
    };
    if (qRegex) {
      filter.$or = [
        { firstName: qRegex },
        { lastName: qRegex },
        { email: qRegex },
        { phone: qRegex },
      ];
    }
    const [data, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('-passwordHash -passwordResetTokenHash -passwordResetExpiresAt -refreshTokenVersion')
        .sort({ firstName: 1, lastName: 1, email: 1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.userModel.countDocuments(filter),
    ]);
    return { data, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
  }

  async searchStaffCandidates(
    id: string,
    actor: any,
    kind: 'employee' | 'manager',
    q?: string,
    limit = 20,
  ) {
    await this.assertCanManageTeam(id, actor);
    if (!['employee', 'manager'].includes(kind)) {
      throw new BadRequestException('kind must be employee or manager');
    }
    if (kind === 'manager' && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admin can change the restaurant manager');
    }
    const qRegex = buildContainsRegex(q);
    const filter: any = kind === 'manager'
      ? {
          role: UserRole.CLIENT,
          isActive: { $ne: false },
          $or: [
            { restaurantId: null },
            { restaurantId: { $exists: false } },
          ],
        }
      : {
          role: { $in: [UserRole.CLIENT, UserRole.EMPLOYEE] },
          isActive: { $ne: false },
          $or: [
            { restaurantId: null },
            { restaurantId: { $exists: false } },
          ],
        };

    if (qRegex) {
      const search = [
        { firstName: qRegex },
        { lastName: qRegex },
        { email: qRegex },
        { phone: qRegex },
      ];
      if (filter.$or) {
        const availability = filter.$or;
        delete filter.$or;
        filter.$and = [{ $or: availability }, { $or: search }];
      } else {
        filter.$or = search;
      }
    }

    return this.userModel
      .find(filter)
      .select('firstName lastName email phone profileImage role restaurantId isActive')
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .limit(Math.min(Math.max(Number(limit || 20), 1), 50));
  }

  async assignEmployee(id: string, userId: string, actor: any) {
    await this.assertCanManageTeam(id, actor);
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (![UserRole.CLIENT, UserRole.EMPLOYEE].includes(user.role)) {
      throw new BadRequestException('Only a client or employee account can be assigned as restaurant employee');
    }
    if (user.restaurantId && String(user.restaurantId) !== id) {
      throw new BadRequestException('User is already assigned to another restaurant');
    }
    user.role = UserRole.EMPLOYEE;
    user.restaurantId = new Types.ObjectId(id);
    user.refreshTokenVersion = Number(user.refreshTokenVersion || 0) + 1;
    await user.save();
    return this.userModel
      .findById(user._id)
      .select('-passwordHash -passwordResetTokenHash -passwordResetExpiresAt -refreshTokenVersion');
  }

  async removeEmployee(id: string, userId: string, actor: any) {
    await this.assertCanManageTeam(id, actor);
    const user = await this.userModel.findOne({
      _id: userId,
      restaurantId: new Types.ObjectId(id),
      role: UserRole.EMPLOYEE,
    });
    if (!user) throw new NotFoundException('Restaurant employee not found');
    user.restaurantId = null as any;
    user.role = UserRole.CLIENT;
    user.refreshTokenVersion = Number(user.refreshTokenVersion || 0) + 1;
    await user.save();
    return { removed: true, userId: String(user._id) };
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
