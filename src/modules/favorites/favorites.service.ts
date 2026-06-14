import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Favorite, FavoriteDocument } from '../../database/schemas/favorite.schema';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';
import { Restaurant, RestaurantDocument } from '../../database/schemas/restaurant.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';

interface FavoriteListItem {
  _id: string;
  menuItemId: string;
  restaurantId: string | null;
  name: string;
  restaurantName: string;
  image: string;
  price: number;
  stock: number;
  isAvailable: boolean;
  isActive: boolean;
  isMenuItemDeleted: boolean;
  createdAt: Date;
}

@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);

  constructor(
    @InjectModel(Favorite.name) private readonly favoriteModel: Model<FavoriteDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<RestaurantDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string): Promise<FavoriteListItem[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const favorites = await this.favoriteModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();

    const menuItemIds = favorites
      .filter((favorite) => !favorite.isMenuItemDeleted)
      .map((favorite) => favorite.menuItemId);
    const menuItems = menuItemIds.length
      ? await this.menuItemModel
          .find({ _id: { $in: menuItemIds } })
          .lean()
      : [];
    const menuItemById = new Map(menuItems.map((item) => [String(item._id), item]));

    return favorites.map((favorite) => {
      const menuItem = menuItemById.get(String(favorite.menuItemId));
      const isMenuItemDeleted = favorite.isMenuItemDeleted || !menuItem;
      return {
        _id: String(favorite._id),
        menuItemId: String(favorite.menuItemId),
        restaurantId: favorite.restaurantId ? String(favorite.restaurantId) : null,
        name: menuItem?.name || favorite.menuItemNameSnapshot || 'Plat supprimé',
        restaurantName: favorite.restaurantNameSnapshot || '',
        image: menuItem?.image || '',
        price: Number(menuItem?.price ?? 0),
        stock: Number(menuItem?.stock ?? 0),
        isAvailable: !isMenuItemDeleted && Boolean(menuItem?.isAvailable),
        isActive: !isMenuItemDeleted && Boolean(menuItem?.isActive),
        isMenuItemDeleted,
        createdAt: (favorite as any).createdAt,
      };
    });
  }

  async listIds(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const favorites = await this.favoriteModel
      .find({ userId: new Types.ObjectId(userId), isMenuItemDeleted: { $ne: true } })
      .select({ menuItemId: 1 })
      .lean();
    return favorites.map((favorite) => String(favorite.menuItemId));
  }

  async add(userId: string, menuItemId: string) {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(menuItemId)) {
      throw new NotFoundException('Plat introuvable');
    }
    const menuItem = await this.menuItemModel.findById(menuItemId).lean();
    if (!menuItem) throw new NotFoundException('Plat introuvable');

    const restaurant = menuItem.restaurantId
      ? await this.restaurantModel.findById(menuItem.restaurantId).select({ name: 1 }).lean()
      : null;

    await this.favoriteModel.updateOne(
      { userId: new Types.ObjectId(userId), menuItemId: new Types.ObjectId(menuItemId) },
      {
        $setOnInsert: {
          userId: new Types.ObjectId(userId),
          menuItemId: new Types.ObjectId(menuItemId),
        },
        $set: {
          restaurantId: menuItem.restaurantId || null,
          menuItemNameSnapshot: menuItem.name || '',
          restaurantNameSnapshot: restaurant?.name || '',
          isMenuItemDeleted: false,
        },
      },
      { upsert: true },
    );

    return { added: true };
  }

  async remove(userId: string, menuItemId: string) {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(menuItemId)) {
      return { removed: false };
    }
    const result = await this.favoriteModel.deleteOne({
      userId: new Types.ObjectId(userId),
      menuItemId: new Types.ObjectId(menuItemId),
    });
    return { removed: result.deletedCount > 0 };
  }

  async markMenuItemDeleted(menuItemId: string) {
    if (!Types.ObjectId.isValid(menuItemId)) return;
    await this.favoriteModel.updateMany(
      { menuItemId: new Types.ObjectId(menuItemId) },
      { $set: { isMenuItemDeleted: true } },
    );
  }

  async notifyBackInStock(menuItemId: string) {
    if (!Types.ObjectId.isValid(menuItemId)) return;
    try {
      const menuItem = await this.menuItemModel.findById(menuItemId).lean();
      if (!menuItem) return;

      const [restaurant, favorites] = await Promise.all([
        menuItem.restaurantId
          ? this.restaurantModel.findById(menuItem.restaurantId).select({ name: 1 }).lean()
          : null,
        this.favoriteModel.find({
          menuItemId: new Types.ObjectId(menuItemId),
          isMenuItemDeleted: { $ne: true },
        }).lean(),
      ]);

      if (!favorites.length) return;

      const userIds = favorites.map((favorite) => favorite.userId).filter(Boolean);
      const users = await this.userModel
        .find({ _id: { $in: userIds } })
        .select({ email: 1, phone: 1, firstName: 1 })
        .lean();

      if (!users.length) return;

      this.logger.log(
        `Notifying ${users.length} user(s) that menu item "${menuItem.name}" is back in stock.`,
      );

      await this.notifications.sendMenuItemBackInStock(
        users.map((user) => ({
          email: user.email,
          phone: user.phone,
          firstName: user.firstName,
        })),
        {
          menuItemId: String(menuItem._id),
          menuItemName: menuItem.name,
          restaurantName: restaurant?.name || '',
          restaurantId: menuItem.restaurantId ? String(menuItem.restaurantId) : '',
        },
      );
    } catch (error: any) {
      this.logger.warn(
        `notifyBackInStock(${menuItemId}) failed: ${error?.message || error}`,
      );
    }
  }
}
