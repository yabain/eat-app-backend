import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { MenuModule } from './modules/menu/menu.module';
import { DeliveryZonesModule } from './modules/delivery-zones/delivery-zones.module';
import { PromoCodesModule } from './modules/promo-codes/promo-codes.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { CartsModule } from './modules/carts/carts.module';
import { FeedbacksModule } from './modules/feedbacks/feedbacks.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { BalancesModule } from './modules/balances/balances.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    AuthModule,
    UsersModule,
    RestaurantsModule,
    CategoriesModule,
    MenuModule,
    DeliveryZonesModule,
    PromoCodesModule,
    OrdersModule,
    PaymentsModule,
    DeliveriesModule,
    NotificationsModule,
    UploadsModule,
    CartsModule,
    FeedbacksModule,
    DashboardModule,
    BalancesModule,
  ],
})
export class AppModule {}
