import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Balance, BalanceSchema } from '../../database/schemas/balance.schema';
import { MenuItem, MenuItemSchema } from '../../database/schemas/menu-item.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Order.name, schema: OrderSchema },
    { name: MenuItem.name, schema: MenuItemSchema },
    { name: Balance.name, schema: BalanceSchema },
  ])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
