import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Delivery, DeliverySchema } from '../../database/schemas/delivery.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Delivery.name, schema: DeliverySchema },
    { name: Order.name, schema: OrderSchema },
    { name: User.name, schema: UserSchema },
  ])],
  providers: [DeliveriesService],
  controllers: [DeliveriesController],
})
export class DeliveriesModule {}
