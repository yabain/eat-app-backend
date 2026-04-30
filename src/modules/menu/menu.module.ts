import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from '../../database/schemas/category.schema';
import { MenuItem, MenuItemSchema } from '../../database/schemas/menu-item.schema';
import { MenuController } from './menu.controller';
import { MenuInventoryService } from './menu-inventory.service';
import { MenuService } from './menu.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
  ],
  providers: [MenuService, MenuInventoryService],
  controllers: [MenuController],
  exports: [MenuService, MenuInventoryService],
})
export class MenuModule {}
