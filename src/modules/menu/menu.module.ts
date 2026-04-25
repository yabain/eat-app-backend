import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MenuItem, MenuItemSchema } from '../../database/schemas/menu-item.schema';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: MenuItem.name, schema: MenuItemSchema }])],
  providers: [MenuService],
  controllers: [MenuController],
  exports: [MenuService],
})
export class MenuModule {}
