import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatMessage, ChatMessageSchema } from '../../database/schemas/chat-message.schema';
import { ChatUser, ChatUserSchema } from '../../database/schemas/chat-user.schema';
import { Restaurant, RestaurantSchema } from '../../database/schemas/restaurant.schema';
import { Table, TableSchema } from '../../database/schemas/table.schema';
import { TablePosition, TablePositionSchema } from '../../database/schemas/table-position.schema';
import { ChatModule } from '../chat/chat.module';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

/**
 * Tables à deux niveaux + positions (sièges) — gestion admin/manager
 * (employee en lecture seule). Le chat de groupe yChat est partagé PAR
 * TABLE ; les émissions socket passent par le ChatRealtimeService exporté
 * par ChatModule (même instance que le gateway).
 *
 * AuditLogsService est fourni par le module global AuditLogsModule.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Table.name, schema: TableSchema },
      { name: TablePosition.name, schema: TablePositionSchema },
      { name: ChatUser.name, schema: ChatUserSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
    ChatModule,
  ],
  controllers: [TablesController],
  providers: [TablesService],
})
export class TablesModule {}
