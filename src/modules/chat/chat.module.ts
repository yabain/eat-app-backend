import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatMessage, ChatMessageSchema } from '../../database/schemas/chat-message.schema';
import { ChatUser, ChatUserSchema } from '../../database/schemas/chat-user.schema';
import { Table, TableSchema } from '../../database/schemas/table.schema';
import { TablePosition, TablePositionSchema } from '../../database/schemas/table-position.schema';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';

/**
 * yChat : avatars (ChatUser), messages, TTL + cron de purge cascade
 * (expirés + orphelins), gateway socket.io, résolution QR du siège scanné.
 * La gestion des tables/positions vit dans le module Tables.
 *
 * CronLeaseService est fourni par le module global CronLeaseModule.
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Table.name, schema: TableSchema },
      { name: TablePosition.name, schema: TablePositionSchema },
      { name: ChatUser.name, schema: ChatUserSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '90d' },
      }),
    }),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatRealtimeService],
  exports: [ChatService, ChatRealtimeService],
})
export class ChatModule {}
