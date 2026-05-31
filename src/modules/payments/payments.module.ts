import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from '../../database/schemas/payment.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { Restaurant, RestaurantSchema } from '../../database/schemas/restaurant.schema';
import { BalanceTransaction, BalanceTransactionSchema } from '../../database/schemas/balance-transaction.schema';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { DigikuntzProvider } from './providers/digikuntz.provider';
import { NotificationsModule } from '../notifications/notifications.module';
import { MenuModule } from '../menu/menu.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: BalanceTransaction.name, schema: BalanceTransactionSchema },
    ]),
    NotificationsModule,
    MenuModule,
  ],
  providers: [PaymentsService, DigikuntzProvider],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
