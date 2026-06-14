import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from '../../database/schemas/category.schema';
import { MenuItem, MenuItemSchema } from '../../database/schemas/menu-item.schema';
import { Restaurant, RestaurantSchema } from '../../database/schemas/restaurant.schema';
import { MenuController } from './menu.controller';
import { MenuInventoryService } from './menu-inventory.service';
import { MenuService } from './menu.service';
import { FavoritesModule } from '../favorites/favorites.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
    FavoritesModule,
  ],
  providers: [MenuService, MenuInventoryService],
  controllers: [MenuController],
  exports: [MenuService, MenuInventoryService],
})
export class MenuModule {}
