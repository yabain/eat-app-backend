import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MenuItem, MenuItemSchema } from '../../database/schemas/menu-item.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { DeliveryZone, DeliveryZoneSchema } from '../../database/schemas/delivery-zone.schema';
import { PromoCode, PromoCodeSchema } from '../../database/schemas/promo-code.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { Cart, CartSchema } from '../../database/schemas/cart.schema';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { MenuModule } from '../menu/menu.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Order.name, schema: OrderSchema },
      { name: DeliveryZone.name, schema: DeliveryZoneSchema },
      { name: PromoCode.name, schema: PromoCodeSchema },
      { name: User.name, schema: UserSchema },
      { name: Cart.name, schema: CartSchema },
    ]),
    NotificationsModule,
    MenuModule,
  ],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
