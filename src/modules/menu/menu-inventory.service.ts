import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../../database/schemas/category.schema';
import { MenuItem, MenuItemDocument } from '../../database/schemas/menu-item.schema';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CronLeaseService } from '../../common/cron-lease/cron-lease.service';

@Injectable()
export class MenuInventoryService implements OnModuleInit {
  private readonly logger = new Logger(MenuInventoryService.name);
  private static readonly RESET_CRON = '0 0 * * *';
  private static readonly RESET_TZ = 'Africa/Douala';

  constructor(
    @InjectModel(MenuItem.name) private readonly menuModel: Model<MenuItemDocument>,
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    private readonly auditLogs: AuditLogsService,
    private readonly cronLease: CronLeaseService,
  ) {}

  onModuleInit() {
    // Log au démarrage pour confirmer que le cron de reset stock est bien
    // enregistré côté serveur. Sans ce log, en cas de timezone invalide ou
    // de container sans tzdata, le cron échoue silencieusement et personne
    // ne s'en aperçoit jusqu'au lendemain.
    this.logger.log(
      `Midnight stock reset cron registered: schedule="${MenuInventoryService.RESET_CRON}" tz="${MenuInventoryService.RESET_TZ}"`,
    );
  }

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

  @Cron(MenuInventoryService.RESET_CRON, { timeZone: MenuInventoryService.RESET_TZ })
  async resetStocksForConfiguredCategories(triggeredBy: 'cron' | 'manual' = 'cron') {
    // Trigger manuel (depuis l'admin) : pas de lease, l'opération est explicite.
    if (triggeredBy === 'cron') {
      // Le reset minuit doit s'exécuter UNE seule fois par jour, peu importe
      // combien d'instances tournent. Lease TTL court (1h) suffisant.
      if (!(await this.cronLease.acquire('menu.resetMidnightStocks', 60 * 60 * 1000))) {
        this.logger.log('Midnight stock reset skipped — another instance holds the lease');
        return;
      }
    }
    this.logger.log(`==== Midnight stock reset starting (triggeredBy=${triggeredBy}) ====`);

    // 1. Trouve toutes les catégories ayant le flag activé.
    const categories = await this.categoryModel
      .find({ resetStockAtMidnight: true })
      .select({ _id: 1, name: 1 })
      .lean();

    if (categories.length === 0) {
      this.logger.warn(
        'Midnight stock reset: NO category has resetStockAtMidnight=true. Activate the toggle on at least one category before triggering.',
      );
      return {
        matchedCount: 0,
        modifiedCount: 0,
        categories: 0,
        categoriesConfigured: [],
        menuItemsInCategories: 0,
        updatedMenuItemIds: [],
      };
    }

    const categoryObjectIds = categories.map((c) => new Types.ObjectId(String(c._id)));
    const categoryStringIds = categories.map((c) => String(c._id));
    this.logger.log(
      `Step 1 — ${categories.length} categor${categories.length > 1 ? 'ies' : 'y'} configured: ` +
      categories.map((c) => `${c.name}(${String(c._id)})`).join(', '),
    );

    // 2. Récupère tous les produits ayant ces catégories.
    // Fallback robuste : matche `categoryId` qu'il soit stocké comme ObjectId
    // ou comme string (cas où des données auraient été insérées hors Mongoose).
    const filter = {
      $or: [
        { categoryId: { $in: categoryObjectIds } },
        { categoryId: { $in: categoryStringIds } as any },
      ],
    };

    const menuItems = await this.menuModel
      .find(filter)
      .select({ _id: 1, name: 1, stock: 1, isAvailable: 1, categoryId: 1 })
      .lean();

    this.logger.log(`Step 2 — Found ${menuItems.length} menu item(s) in those categories`);

    if (menuItems.length === 0) {
      this.logger.warn(
        `Midnight stock reset: 0 menu items reference categories ${categoryStringIds.join(', ')}. ` +
        `Vérifie que des produits ont bien ces catégories assignées (champ categoryId du menu item).`,
      );
      return {
        matchedCount: 0,
        modifiedCount: 0,
        categories: categories.length,
        categoriesConfigured: categories.map((c) => ({ _id: String(c._id), name: c.name })),
        menuItemsInCategories: 0,
        updatedMenuItemIds: [],
      };
    }

    // 3. Parcours et met à jour CHAQUE produit individuellement (boucle explicite).
    // On utilise updateOne par item pour avoir un log précis et pouvoir
    // continuer même si un item plante. Plus lent qu'updateMany mais transparent.
    const updatedMenuItemIds: string[] = [];
    let modifiedCount = 0;
    let matchedCount = 0;

    for (const item of menuItems) {
      const itemId = String(item._id);
      try {
        const updateResult = await this.menuModel.updateOne(
          { _id: item._id },
          { $set: { stock: 0, isAvailable: false } },
        );
        matchedCount += updateResult.matchedCount ?? 0;
        modifiedCount += updateResult.modifiedCount ?? 0;
        if ((updateResult.matchedCount ?? 0) > 0) {
          updatedMenuItemIds.push(itemId);
          this.logger.log(
            `  ✓ ${item.name} (${itemId}): stock ${item.stock} → 0, isAvailable ${item.isAvailable} → false`,
          );
        } else {
          this.logger.warn(`  ✗ ${item.name} (${itemId}): updateOne matched 0 documents`);
        }
      } catch (err: any) {
        this.logger.error(`  ✗ ${item.name} (${itemId}): update failed — ${err?.message || err}`);
      }
    }

    this.logger.log(
      `==== Midnight stock reset completed: matched=${matchedCount}, modified=${modifiedCount} (over ${menuItems.length} candidate items) ====`,
    );

    // Trace explicite dans l'audit log uniquement quand déclenché par le cron.
    // En manuel, l'interceptor HTTP s'en occupe déjà via la route POST.
    if (triggeredBy === 'cron') {
      await this.auditLogs.record({
        actorId: null,
        actorEmail: 'system',
        actorRole: 'system',
        action: 'menu_item.reset_midnight_stocks',
        resourceType: 'menu_item',
        metadata: {
          triggeredBy,
          categories: categories.length,
          categoriesConfigured: categories.map((c) => ({ _id: String(c._id), name: c.name })),
          menuItemsInCategories: menuItems.length,
          matchedCount,
          modifiedCount,
          updatedMenuItemIds,
        },
      });
    }

    return {
      matchedCount,
      modifiedCount,
      categories: categories.length,
      categoriesConfigured: categories.map((c) => ({ _id: String(c._id), name: c.name })),
      menuItemsInCategories: menuItems.length,
      updatedMenuItemIds,
    };
  }
}
