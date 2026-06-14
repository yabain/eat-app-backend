import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Favorite, FavoriteSchema } from '../../database/schemas/favorite.schema';
import { MenuItem, MenuItemSchema } from '../../database/schemas/menu-item.schema';
import { Restaurant, RestaurantSchema } from '../../database/schemas/restaurant.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Favorite.name, schema: FavoriteSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [FavoritesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
