import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MerlinConversation,
  MerlinConversationSchema,
} from '../../database/schemas/merlin-conversation.schema';
import { MenuItem, MenuItemSchema } from '../../database/schemas/menu-item.schema';
import { Order, OrderSchema } from '../../database/schemas/order.schema';
import { Restaurant, RestaurantSchema } from '../../database/schemas/restaurant.schema';
import { MerlinController } from './merlin.controller';
import { MerlinService } from './merlin.service';
import { ContextBuilder } from './prompts/context.builder';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MerlinConversation.name, schema: MerlinConversationSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [MerlinController],
  providers: [MerlinService, ContextBuilder],
})
export class MerlinModule {}
