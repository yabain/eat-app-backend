import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { buildPaginationMeta, normalizePagination } from '../../common/pagination/paginate';
import { Feedback, FeedbackDocument } from '../../database/schemas/feedback.schema';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateMyFeedbackDto } from './dto/update-my-feedback.dto';

@Injectable()
export class FeedbacksService {
  constructor(@InjectModel(Feedback.name) private feedbackModel: Model<FeedbackDocument>) {}

  async createMyFeedback(userId: string, dto: CreateFeedbackDto) {
    if (!Types.ObjectId.isValid(dto.entityId)) {
      throw new BadRequestException('entityId must be a mongodb id');
    }

    const existing = await this.feedbackModel.findOne({ userId, entityId: dto.entityId });
    if (existing) {
      throw new ConflictException('You already have a feedback for this entity. Please edit your existing feedback');
    }

    try {
      return await this.feedbackModel.create({
        userId: new Types.ObjectId(userId),
        entityId: new Types.ObjectId(dto.entityId),
        rating: dto.rating,
        comment: dto.comment,
        status: dto.status ?? true,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('You already have a feedback for this entity. Please edit your existing feedback');
      }
      throw error;
    }
  }

  async updateMyFeedback(userId: string, entityId: string, dto: UpdateMyFeedbackDto) {
    if (!Types.ObjectId.isValid(entityId)) {
      throw new BadRequestException('entityId must be a mongodb id');
    }

    const feedback = await this.feedbackModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), entityId: new Types.ObjectId(entityId) },
      dto,
      { new: true },
    );
    if (!feedback) throw new NotFoundException('Feedback not found for this entity');
    return feedback;
  }

  async listByEntity(entityId: string, page?: number, limit?: number) {
    if (!Types.ObjectId.isValid(entityId)) {
      throw new BadRequestException('entityId must be a mongodb id');
    }

    const pagination = normalizePagination(page, limit ?? 10);
    const filter = { entityId: new Types.ObjectId(entityId), status: true };
    const [data, total] = await Promise.all([
      this.feedbackModel
        .find(filter)
        .populate({
          path: 'userId',
          select: 'firstName lastName email phone profileImage role restaurantId isActive',
        })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      this.feedbackModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async getEntityStats(entityId: string) {
    if (!Types.ObjectId.isValid(entityId)) {
      throw new BadRequestException('entityId must be a mongodb id');
    }

    const [stats] = await this.feedbackModel.aggregate([
      { $match: { entityId: new Types.ObjectId(entityId), status: true } },
      {
        $group: {
          _id: '$entityId',
          totalFeedbacks: { $sum: 1 },
          averageRaw: { $avg: '$rating' },
        },
      },
    ]);

    const totalFeedbacks = stats?.totalFeedbacks ?? 0;
    const averageRaw = stats?.averageRaw ?? 0;
    const averageRating = Math.round(averageRaw * 2) / 2;

    return {
      entityId,
      totalFeedbacks,
      averageRating,
      averageRaw,
      scale: '/5',
    };
  }
}
