import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../../database/schemas/category.schema';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';

@Injectable()
export class MenuInventoryService {
  private readonly logger = new Logger(MenuInventoryService.name);

  constructor(
    @InjectModel(MenuItem.name) private readonly menuModel: Model<MenuItemDocument>,
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  async adjustStock(
    menuItemId: string | Types.ObjectId,
    delta: number,
    session?: ClientSession,
  ) {
    const update = [
      { $set: { stock: { $add: ['$stock', delta] } } },
      { $set: { isAvailable: { $gt: ['$stock', 0] } } },
    ];
    const options: any = { new: true };
    if (session) options.session = session;

    if (delta < 0) {
      // Décrément conditionnel : si le stock est insuffisant, l'update échoue
      // (retourne null) plutôt que de descendre en négatif.
      const required = -delta;
      const result = await this.menuModel.findOneAndUpdate(
        { _id: menuItemId, stock: { $gte: required } },
        update,
        options,
      );
      if (!result) throw new BadRequestException(`Insufficient stock for menu item ${menuItemId}`);
      return result;
    }

    return this.menuModel.findByIdAndUpdate(menuItemId, update, options);
  }

  normalizeAvailabilityForStock<T extends { stock?: number; isAvailable?: boolean }>(payload: T): T {
    if (payload.stock === undefined) return payload;
    return { ...payload, isAvailable: payload.stock > 0 };
  }

  @Cron('0 0 * * *', { timeZone: 'Africa/Douala' })
  async resetStocksForConfiguredCategories() {
    const categories = await this.categoryModel
      .find({ resetStockAtMidnight: true })
      .select({ _id: 1 })
      .lean();

    if (categories.length === 0) {
      this.logger.debug('No category configured for midnight stock reset');
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const result = await this.menuModel.updateMany(
      {
        categoryId: { $in: categories.map((category) => category._id) },
        $or: [{ stock: { $ne: 0 } }, { isAvailable: { $ne: false } }],
      },
      { $set: { stock: 0, isAvailable: false } },
    );

    this.logger.log(
      `Midnight stock reset completed for ${categories.length} categories: ${result.modifiedCount} menu items updated`,
    );

    return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }
}
