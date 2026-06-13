import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cart, CartDocument } from '../../database/schemas/cart.schema';
import { Category, CategoryDocument } from '../../database/schemas/category.schema';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartsService {
  // NB: le stock n'est PAS décrémenté à l'ajout au panier. La réservation
  // atomique se fait au moment de la création de la commande (cf.
  // OrdersService.placeOrderWithinSession). Le panier valide seulement la
  // disponibilité côté lecture pour donner un feedback utilisateur immédiat.
  constructor(
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    @InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>,
  ) {}

  private async findMenuItemOrFail(menuItemId: string) {
    const menuItem = await this.menuModel.findById(menuItemId);
    if (!menuItem) throw new NotFoundException('Menu item not found');
    if (!menuItem.isActive || !menuItem.isAvailable) throw new BadRequestException('Menu item is not available');
    return menuItem;
  }

  /**
   * Vérifie que `accompanimentId` (s'il est fourni) appartient bien aux
   * accompagnements disponibles du menu item ET qu'il est actif dans la
   * catégorie. Renvoie le nom de l'accompagnement (snapshot dénormalisé)
   * ou une chaîne vide si pas d'accompagnement choisi.
   *
   * Si le menu item a des accompagnements disponibles et qu'aucun n'est
   * choisi, on tolère l'absence (le client peut décider en panier plus tard) —
   * mais le frontend impose la sélection par défaut au moment de l'ajout.
   */
  private async resolveAccompaniment(
    menuItem: MenuItemDocument,
    accompanimentId: string | null | undefined,
  ): Promise<{ id: Types.ObjectId | null; name: string }> {
    if (!accompanimentId) return { id: null, name: '' };
    const available = (menuItem.availableAccompanimentIds || []).map((id: any) => String(id));
    if (!available.includes(String(accompanimentId))) {
      throw new BadRequestException('Accompagnement non disponible pour ce produit');
    }
    if (!menuItem.categoryId) {
      throw new BadRequestException('Le produit n\'a pas de catégorie associée');
    }
    const category = await this.categoryModel
      .findById(menuItem.categoryId)
      .select({ accompaniments: 1 })
      .lean();
    if (!category) throw new BadRequestException('Catégorie introuvable');
    const sub = (category.accompaniments || []).find(
      (a: any) => String(a._id) === String(accompanimentId),
    );
    if (!sub) throw new BadRequestException('Accompagnement introuvable dans la catégorie');
    if (sub.isActive === false) throw new BadRequestException('Accompagnement désactivé');
    return { id: new Types.ObjectId(accompanimentId), name: sub.name };
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
    return this.cartModel
      .findById(id)
      .populate({
        path: 'items.menuItemId',
        populate: {
          path: 'categoryId',
          select: 'name maxItemsPerOrder',
        },
      })
      .populate('restaurantId');
  }

  private async assertCategoryLimit(
    cart: CartDocument,
    targetMenuItem: MenuItemDocument,
    targetQuantity: number,
  ) {
    if (!targetMenuItem.categoryId) return;

    const category = await this.categoryModel
      .findById(targetMenuItem.categoryId)
      .select('name maxItemsPerOrder');
    const limit = Math.max(0, Math.floor(Number(category?.maxItemsPerOrder || 0)));
    if (!category || limit === 0) return;

    const otherCartItems = cart.items.filter(
      (item) => String(item.menuItemId) !== String(targetMenuItem._id),
    );
    const otherMenuIds = otherCartItems.map((item) => item.menuItemId);
    const otherMenuItems = otherMenuIds.length
      ? await this.menuModel.find({ _id: { $in: otherMenuIds } }).select('_id categoryId')
      : [];
    const categoryId = String(targetMenuItem.categoryId);
    const menuCategoryById = new Map(
      otherMenuItems.map((menuItem) => [String(menuItem._id), String(menuItem.categoryId || '')]),
    );
    const otherQuantity = otherCartItems.reduce((total, item) => {
      return menuCategoryById.get(String(item.menuItemId)) === categoryId
        ? total + Number(item.quantity || 0)
        : total;
    }, 0);
    const requestedTotal = otherQuantity + targetQuantity;

    if (requestedTotal > limit) {
      throw new BadRequestException(
        `La catégorie "${category.name}" est limitée à ${limit} article(s) par commande`,
      );
    }
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

    const accompaniment = await this.resolveAccompaniment(menuItem, dto.accompanimentId);

    // Une ligne panier est unique par couple (menuItemId, accompanimentId) :
    // si le client commande le même produit avec deux accompagnements
    // distincts, on les stocke comme deux lignes pour préserver le choix
    // individuel dans la commande finale.
    const existing = cart.items.find(
      (i) =>
        String(i.menuItemId) === dto.menuItemId
        && String(i.accompanimentId || '') === String(accompaniment.id || ''),
    );
    if (existing) {
      const nextQty = existing.quantity + dto.quantity;
      if (nextQty > menuItem.stock) throw new BadRequestException('Requested quantity exceeds available stock');
      await this.assertCategoryLimit(cart, menuItem, nextQty);
      existing.quantity = nextQty;
    } else {
      await this.assertCategoryLimit(cart, menuItem, dto.quantity);
      cart.items.push({
        menuItemId: new Types.ObjectId(dto.menuItemId),
        quantity: dto.quantity,
        accompanimentId: accompaniment.id,
        accompanimentName: accompaniment.name,
      } as any);
    }
    cart.restaurantId = menuItem.restaurantId;
    await cart.save();
    return this.populateCart(cart._id);
  }

  async updateItem(userId: string, menuItemId: string, dto: UpdateCartItemDto) {
    const cart = await this.findOrCreateCart(userId);
    const item = cart.items.find((i) => String(i.menuItemId) === menuItemId);
    if (!item) throw new NotFoundException('Item not found in cart');

    const menuItem = await this.findMenuItemOrFail(menuItemId);
    if (dto.quantity > menuItem.stock) {
      throw new BadRequestException('Requested quantity exceeds available stock');
    }
    await this.assertCategoryLimit(cart, menuItem, dto.quantity);

    // Mise à jour optionnelle de l'accompagnement choisi
    const setFields: Record<string, any> = { 'items.$.quantity': dto.quantity };
    if (dto.accompanimentId !== undefined) {
      const accompaniment = await this.resolveAccompaniment(menuItem, dto.accompanimentId);
      setFields['items.$.accompanimentId'] = accompaniment.id;
      setFields['items.$.accompanimentName'] = accompaniment.name;
    }

    const updated = await this.cartModel.findOneAndUpdate(
      { _id: cart._id, 'items.menuItemId': new Types.ObjectId(menuItemId) },
      { $set: setFields },
      { new: true },
    );
    return this.populateCart(updated._id);
  }

  async removeItem(userId: string, menuItemId: string) {
    const cart = await this.findOrCreateCart(userId);
    const item = cart.items.find((i) => String(i.menuItemId) === menuItemId);
    if (!item) throw new NotFoundException('Item not found in cart');

    cart.items = cart.items.filter((i) => String(i.menuItemId) !== menuItemId) as any;
    if (cart.items.length === 0) cart.restaurantId = null;
    await cart.save();
    return this.populateCart(cart._id);
  }

  async clear(userId: string) {
    const cart = await this.findOrCreateCart(userId);
    cart.items = [];
    cart.restaurantId = null;
    await cart.save();
    return { ok: true };
  }
}
