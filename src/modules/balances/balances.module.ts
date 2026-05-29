import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BalanceTransaction, BalanceTransactionSchema } from '../../database/schemas/balance-transaction.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { Restaurant, RestaurantSchema } from '../../database/schemas/restaurant.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { WithdrawalRequest, WithdrawalRequestSchema } from '../../database/schemas/withdrawal-request.schema';
import { DigikuntzProvider } from '../payments/providers/digikuntz.provider';
import { BalancesController, BalancesWebhookController } from './balances.controller';
import { BalancesService } from './balances.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BalanceTransaction.name, schema: BalanceTransactionSchema },
      { name: WithdrawalRequest.name, schema: WithdrawalRequestSchema },
      { name: User.name, schema: UserSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  providers: [BalancesService, DigikuntzProvider],
  controllers: [BalancesController, BalancesWebhookController],
  exports: [BalancesService],
})
export class BalancesModule {}
