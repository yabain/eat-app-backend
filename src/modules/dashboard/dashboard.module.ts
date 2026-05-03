import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BalanceTransaction, BalanceTransactionSchema } from '../../database/schemas/balance-transaction.schema';
import { MenuItem, MenuItemSchema } from '../../database/schemas/menu-item.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Order.name, schema: OrderSchema },
    { name: MenuItem.name, schema: MenuItemSchema },
    { name: BalanceTransaction.name, schema: BalanceTransactionSchema },
  ])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
