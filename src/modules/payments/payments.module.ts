import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from '../../database/schemas/payment.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { DigikuntzProvider } from './providers/digikuntz.provider';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  providers: [PaymentsService, DigikuntzProvider],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
