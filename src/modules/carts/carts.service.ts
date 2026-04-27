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

  private populateCart(id: any) {
    return this.cartModel.findById(id).populate('items.menuItemId').populate('restaurantId');
  }

  async getMyCart(userId: string) {
    const cart = await this.findOrCreateCart(userId);
    return this.populateCart(cart._id);
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
    await Promise.all([
      cart.save(),
      this.menuModel.findByIdAndUpdate(dto.menuItemId, { $inc: { stock: -dto.quantity } }),
    ]);
    return this.populateCart(cart._id);
  }

  async updateItem(userId: string, menuItemId: string, dto: UpdateCartItemDto) {
    const cart = await this.findOrCreateCart(userId);
    const item = cart.items.find((i) => String(i.menuItemId) === menuItemId);
    if (!item) throw new NotFoundException('Item not found in cart');

    const delta = item.quantity - dto.quantity;
    const menuItem = await this.findMenuItemOrFail(menuItemId);
    if (menuItem.stock + delta < 0) {
      throw new BadRequestException('Requested quantity exceeds available stock');
    }

    const updated = await this.cartModel.findOneAndUpdate(
      { _id: cart._id, 'items.menuItemId': new Types.ObjectId(menuItemId) },
      { $set: { 'items.$.quantity': dto.quantity } },
      { new: true },
    );
    await this.menuModel.findByIdAndUpdate(menuItemId, { $inc: { stock: delta } });
    return this.populateCart(updated._id);
  }

  async removeItem(userId: string, menuItemId: string) {
    const cart = await this.findOrCreateCart(userId);
    const item = cart.items.find((i) => String(i.menuItemId) === menuItemId);
    if (!item) throw new NotFoundException('Item not found in cart');

    cart.items = cart.items.filter((i) => String(i.menuItemId) !== menuItemId) as any;
    if (cart.items.length === 0) cart.restaurantId = null;
    await Promise.all([
      cart.save(),
      this.menuModel.findByIdAndUpdate(menuItemId, { $inc: { stock: item.quantity } }),
    ]);
    return this.populateCart(cart._id);
  }

  async clear(userId: string) {
    const cart = await this.findOrCreateCart(userId);
    const stockUpdates = cart.items.map((i) =>
      this.menuModel.findByIdAndUpdate(String(i.menuItemId), { $inc: { stock: i.quantity } }),
    );
    cart.items = [];
    cart.restaurantId = null;
    await Promise.all([cart.save(), ...stockUpdates]);
    return { ok: true };
  }
}
