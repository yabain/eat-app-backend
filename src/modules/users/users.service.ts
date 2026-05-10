import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { UserRole } from '../../common/enums/roles.enum';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { buildContainsRegex, parseBooleanQuery } from '../../common/utils/search.util';
import { deleteLocalUpload, deleteReplacedLocalUpload } from '../../common/utils/local-upload.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  private sanitizeRoleForManager(role?: UserRole) {
    const finalRole = role || UserRole.EMPLOYEE;
    if (![UserRole.EMPLOYEE, UserRole.DRIVER].includes(finalRole)) {
      throw new ForbiddenException('Manager can only assign employee or driver roles');
    }
    return finalRole;
  }

  private async hashPassword(password?: string) {
    if (!password) return undefined;
    return bcrypt.hash(password, 10);
  }

  async create(dto: CreateUserDto) {
    const payload = {
      ...dto,
      email: dto.email.toLowerCase(),
      passwordHash: await this.hashPassword(dto.password),
    };
    delete (payload as any).password;
    const created = await this.userModel.create(payload);
    return this.userModel.findById(created._id).select('-passwordHash');
  }

  async findAll(
    page?: number,
    limit?: number,
    filters?: { q?: string; role?: UserRole; isActive?: string; restaurantId?: string },
  ) {
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(filters?.q);
    const filter: any = {};
    if (filters?.role) filter.role = filters.role;
    const isActive = parseBooleanQuery(filters?.isActive);
    if (isActive !== undefined) filter.isActive = isActive;
    if (filters?.restaurantId) filter.restaurantId = filters.restaurantId;
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
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.userModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  findOne(id: string) {
    return this.userModel.findById(id).select('-passwordHash');
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.userModel.findById(id);
    if (!existing) {
      await deleteLocalUpload(dto.profileImage);
      throw new NotFoundException('User not found');
    }
    const payload: any = { ...dto };
    if (dto.email) payload.email = dto.email.toLowerCase();
    if (dto.password) payload.passwordHash = await this.hashPassword(dto.password);
    delete payload.password;
    const user = await this.userModel.findByIdAndUpdate(id, payload, { new: true }).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    if (payload.profileImage !== undefined) await deleteReplacedLocalUpload(existing.profileImage, payload.profileImage);
    return user;
  }

  async updateForActor(actor: any, id: string, dto: UpdateUserDto) {
    if (actor.role === UserRole.ADMIN) return this.update(id, dto);
    if (String(actor.sub) !== String(id)) {
      throw new ForbiddenException('You can only update your own profile');
    }

    const payload: any = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email ? dto.email.toLowerCase() : undefined,
      phone: dto.phone,
      profileImage: dto.profileImage,
    };
    if (dto.password) payload.passwordHash = await this.hashPassword(dto.password);
    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

    const existing = await this.userModel.findById(id);
    if (!existing) {
      await deleteLocalUpload(payload.profileImage);
      throw new NotFoundException('User not found');
    }
    const user = await this.userModel.findByIdAndUpdate(id, payload, { new: true }).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    if (payload.profileImage !== undefined) await deleteReplacedLocalUpload(existing.profileImage, payload.profileImage);
    return user;
  }

  remove(id: string) {
    return this.userModel.findByIdAndDelete(id);
  }

  async createEmployee(manager: any, dto: CreateEmployeeDto) {
    if (!manager.restaurantId) throw new BadRequestException('Manager must be assigned to a restaurant');

    const role = this.sanitizeRoleForManager(dto.role);
    const passwordHash = await this.hashPassword(dto.password);

    const created = await this.userModel.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email.toLowerCase(),
      phone: dto.phone,
      role,
      restaurantId: manager.restaurantId,
      isActive: dto.isActive ?? true,
      passwordHash,
    });
    return this.userModel.findById(created._id).select('-passwordHash');
  }

  async findEmployees(manager: any, page?: number, limit?: number, q?: string) {
    if (!manager.restaurantId) throw new BadRequestException('Manager must be assigned to a restaurant');
    const pagination = normalizePagination(page, limit);
    const qRegex = buildContainsRegex(q);
    const filter = {
      restaurantId: manager.restaurantId,
      role: { $in: [UserRole.EMPLOYEE, UserRole.DRIVER] },
      ...(qRegex
        ? {
            $or: [
              { firstName: qRegex },
              { lastName: qRegex },
              { email: qRegex },
              { phone: qRegex },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.userModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async updateEmployee(manager: any, id: string, dto: UpdateEmployeeDto) {
    if (!manager.restaurantId) throw new BadRequestException('Manager must be assigned to a restaurant');
    const employee = await this.userModel.findById(id);
    if (!employee) throw new NotFoundException('User not found');

    const isOwnedByManagerRestaurant = employee.restaurantId?.toString() === String(manager.restaurantId);
    const isEmployeeRole = [UserRole.EMPLOYEE, UserRole.DRIVER].includes(employee.role);
    if (!isOwnedByManagerRestaurant || !isEmployeeRole) {
      throw new ForbiddenException('You can only manage employees from your restaurant');
    }

    const payload: any = { ...dto };
    if (dto.email) payload.email = dto.email.toLowerCase();
    if (dto.password) payload.passwordHash = await this.hashPassword(dto.password);
    if (dto.role) payload.role = this.sanitizeRoleForManager(dto.role);
    delete payload.password;

    const updated = await this.userModel.findByIdAndUpdate(id, payload, { new: true }).select('-passwordHash');
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async getMyProfileImage(userId: string) {
    const user = await this.userModel.findById(userId).select('profileImage');
    if (!user) throw new NotFoundException('User not found');
    return { profileImage: user.profileImage || null };
  }

  async updateMyProfileImage(userId: string, profileImage: string) {
    const existing = await this.userModel.findById(userId).select('profileImage');
    if (!existing) {
      await deleteLocalUpload(profileImage);
      throw new NotFoundException('User not found');
    }
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { profileImage },
      { new: true },
    ).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    await deleteReplacedLocalUpload(existing.profileImage, profileImage);
    return user;
  }

  async updateProfileImageForActor(actor: any, id: string, profileImage: string) {
    if (actor.role !== UserRole.ADMIN && String(actor.sub) !== String(id)) {
      throw new ForbiddenException('You can only update your own profile image');
    }
    return this.updateMyProfileImage(id, profileImage);
  }

  async deleteMyProfileImage(userId: string) {
    const existing = await this.userModel.findById(userId).select('profileImage');
    if (!existing) throw new NotFoundException('User not found');
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $unset: { profileImage: 1 } },
      { new: true },
    ).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    await deleteLocalUpload(existing.profileImage);
    return user;
  }

  async activateUser(id: string) {
    const user = await this.userModel.findByIdAndUpdate(
      id,
      { isActive: true },
      { new: true },
    ).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async deactivateUser(id: string) {
    const user = await this.userModel.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    ).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
