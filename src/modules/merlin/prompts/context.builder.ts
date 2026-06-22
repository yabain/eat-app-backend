import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MenuItem, MenuItemDocument } from '../../../database/schemas/menu-item.schema';
import { Order } from '../../../database/schemas/order.schema';
import { Restaurant, RestaurantDocument } from '../../../database/schemas/restaurant.schema';

@Injectable()
export class ContextBuilder {
  constructor(
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(MenuItem.name) private menuItemModel: Model<MenuItemDocument>,
    @InjectModel(Order.name) private orderModel: Model<Order>,
  ) {}

  async build(user: any): Promise<string> {
    const role = user?.role || 'visitor';
    const parts: string[] = [];

    // Contexte public : restaurants actifs
    const activeRestos = await this.restaurantModel
      .find({ status: 'active' })
      .select('name slug')
      .limit(50)
      .lean();
    const restoCount = activeRestos.length;
    const restoList = activeRestos.map((r) => r.name).join(', ');

    // Horaires (on prend le premier restaurant comme référence)
    // const firstResto = activeRestos[0];

    // Quelques produits en exemple
    const sampleItems = await this.menuItemModel
      .find({ isActive: true, isAvailable: true, stock: { $gt: 0 } })
      .populate('restaurantId', 'name')
      .select('name price restaurantId')
      .limit(5)
      .lean();

    const itemsPreview = sampleItems
      .map((i) => `- ${i.name} (${i.price} FCFA) — ${(i.restaurantId as any)?.name || ''}`)
      .join('\n');

    parts.push(
      `Aujourd'hui, Eat App compte ${restoCount} restaurant(s) actif(s) : ${restoList}.`,
      `Exemples d'articles disponibles :\n${itemsPreview}`,
    );

    // Contexte client connecté
    if (role === 'client' && user?.sub) {
      const recentOrders: any[] = await this.orderModel
        .find({ userId: new Types.ObjectId(user.sub) })
        .sort({ createdAt: -1 })
        .limit(3)
        .select('orderNumber orderStatus paymentStatus createdAt pricingSnapshot.grandTotal')
        .lean();

      if (recentOrders.length > 0) {
        const ordersSummary = recentOrders
          .map(
            (o) =>
              `- Commande #${o.orderNumber} : ${o.orderStatus}, paiement ${o.paymentStatus}, total ${o.pricingSnapshot?.grandTotal || '?'} FCFA (${new Date(o.createdAt).toLocaleDateString('fr-FR')})`,
          )
          .join('\n');
        parts.push(`Commandes récentes de l'utilisateur :\n${ordersSummary}`);
      }
    }

    // Contexte manager
    if ((role === 'manager' || role === 'employee') && user?.restaurantId) {
      const resto = await this.restaurantModel.findById(user.restaurantId).select('name').lean();
      if (resto) {
        const pendingOrders = await this.orderModel
          .find({
            restaurantId: new Types.ObjectId(user.restaurantId),
            orderStatus: { $in: ['confirmed', 'preparing'] },
          })
          .countDocuments();

        const lowStockItems = await this.menuItemModel
          .find({
            restaurantId: new Types.ObjectId(user.restaurantId),
            stock: { $gt: 0, $lte: 5 },
          })
          .select('name stock')
          .lean();

        const lowStockSummary = lowStockItems
          .map((i) => `- ${i.name} (stock: ${i.stock})`)
          .join('\n');

        parts.push(
          `Restaurant : ${resto.name}.`,
          `Commandes en attente : ${pendingOrders}.`,
          lowStockSummary
            ? `Articles en stock faible :\n${lowStockSummary}`
            : 'Aucun article en stock faible.',
        );
      }
    }

    // Contexte admin
    if (role === 'admin') {
      const totalRestos = await this.restaurantModel.countDocuments();
      const totalOrders = await this.orderModel.countDocuments();
      parts.push(
        `Statistiques plateforme : ${totalRestos} restaurants, ${totalOrders} commandes au total.`,
      );
    }

    return parts.join('\n\n');
  }
}
