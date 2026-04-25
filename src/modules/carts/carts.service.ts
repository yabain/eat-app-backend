import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cart, CartDocument } from '../../database/schemas/cart.schema';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartsService {
  constructor(
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    @InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>,
  ) {}

  private async findMenuItemOrFail(menuItemId: string) {
    const menuItem = await this.menuModel.findById(menuItemId);
    if (!menuItem) throw new NotFoundException('Menu item not found');
    if (!menuItem.isActive || !menuItem.isAvailable) throw new BadRequestException('Menu item is not available');
    return menuItem;
  }

  private async findOrCreateCart(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    return this.cartModel.findOneAndUpdate(
      { userId: userObjectId },
      {
        $setOnInsert: {
          userId: userObjectId,
          items: [],
          restaurantId: null,
        },
      },
      { new: true, upsert: true },
    );
  }

  async getMyCart(userId: string) {
    const cart = await this.findOrCreateCart(userId);
    return this.cartModel.findById(cart._id).populate('items.menuItemId');
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const menuItem = await this.findMenuItemOrFail(dto.menuItemId);
    const cart = await this.findOrCreateCart(userId);

    if (cart.restaurantId && String(cart.restaurantId) !== String(menuItem.restaurantId)) {
      throw new BadRequestException('Cart can only contain items from one restaurant');
    }
    if (dto.quantity > menuItem.stock) {
      throw new BadRequestException('Requested quantity exceeds available stock');
    }

    const existing = cart.items.find((i) => String(i.menuItemId) === dto.menuItemId);
    if (existing) {
      const nextQty = existing.quantity + dto.quantity;
      if (nextQty > menuItem.stock) throw new BadRequestException('Requested quantity exceeds available stock');
      existing.quantity = nextQty;
    } else {
      cart.items.push({ menuItemId: new Types.ObjectId(dto.menuItemId), quantity: dto.quantity } as any);
    }
    cart.restaurantId = menuItem.restaurantId;
    await cart.save();
    return this.cartModel.findById(cart._id).populate('items.menuItemId');
  }

  async updateItem(userId: string, menuItemId: string, dto: UpdateCartItemDto) {
    const menuItem = await this.findMenuItemOrFail(menuItemId);
    if (dto.quantity > menuItem.stock) {
      throw new BadRequestException('Requested quantity exceeds available stock');
    }
    const cart = await this.findOrCreateCart(userId);
    const item = cart.items.find((i) => String(i.menuItemId) === menuItemId);
    if (!item) throw new NotFoundException('Item not found in cart');
    item.quantity = dto.quantity;
    await cart.save();
    return this.cartModel.findById(cart._id).populate('items.menuItemId');
  }

  async removeItem(userId: string, menuItemId: string) {
    const cart = await this.findOrCreateCart(userId);
    const nextItems = cart.items.filter((i) => String(i.menuItemId) !== menuItemId);
    if (nextItems.length === cart.items.length) throw new NotFoundException('Item not found in cart');
    cart.items = nextItems as any;
    if (cart.items.length === 0) cart.restaurantId = null;
    await cart.save();
    return this.cartModel.findById(cart._id).populate('items.menuItemId');
  }

  async clear(userId: string) {
    const cart = await this.findOrCreateCart(userId);
    cart.items = [];
    cart.restaurantId = null;
    await cart.save();
    return { ok: true };
  }
}
