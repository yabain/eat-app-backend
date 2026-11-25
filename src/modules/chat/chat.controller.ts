import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreateChatAvatarDto } from './dto/create-chat-avatar.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ChatService } from './chat.service';

/**
 * yChat — surface session client (avatars + messages + résolution QR).
 * La gestion des tables et de leurs positions (sièges) vit dans le module
 * `/tables` (admin/manager) ; ce module ne garde que le scan QR (by-qr).
 */
@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly service: ChatService) {}

  // ------------------------------------------------------------------
  // Résolution QR (siège scanné)
  // ------------------------------------------------------------------

  // NOTE : c'est la seule route `positions` restante du chat (pas de
  // conflit de pattern). Session obligatoire (yChat exige une session),
  // aucun rôle requis — c'est la route appelée après le scan du QR par un
  // client.
  @UseGuards(JwtAuthGuard)
  @Get('positions/by-qr/:idQr')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Résoudre un QR scanné : { position, tableId, restaurantId } ou 404 (session requise)',
  })
  @ApiParam({ name: 'idQr', example: 'AbCdEfGh1234' })
  @ApiOkResponse({ description: 'Position (siège) trouvée + tableId du chat de groupe' })
  findByQr(@Req() req: any, @Param('idQr') idQr: string) {
    return this.service.findPositionByQr(idQr);
  }

  // ------------------------------------------------------------------
  // Avatars
  // ------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Post('avatars')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Créer un avatar sur un siège (session requise, isPersistant tracé sur userId)' })
  @ApiCreatedResponse({ description: 'Avatar créé' })
  createAvatar(@Req() req: any, @Body() dto: CreateChatAvatarDto) {
    return this.service.createAvatar(req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('avatars')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister les avatars non expirés d\'une table (toutes positions)' })
  @ApiQuery({ name: 'tableId', required: true, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Avatars online/offline de la table' })
  listAvatars(@Req() req: any, @Query('tableId') tableId: string) {
    return this.service.listAvatars(req.user, tableId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('avatars/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Supprimer son avatar (cascade messages + socket avatar:left)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Avatar supprimé, messages en cascade' })
  deleteAvatar(@Req() req: any, @Param('id') id: string) {
    return this.service.deleteAvatar(req.user, id);
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Post('messages')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Envoyer un message (fromAvatarId doit appartenir à l\'actor ; toAvatarId null = groupe)' })
  @ApiCreatedResponse({ description: 'Message créé (TTL 10h)' })
  createMessage(@Req() req: any, @Body() dto: CreateChatMessageDto) {
    return this.service.createMessage(req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('messages')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Lister les messages non expirés d\'une table depuis la perspective de l\'actor ' +
      '(groupe public + privés le concernant ; avatarId optionnel pour choisir la perspective).',
  })
  @ApiQuery({ name: 'tableId', required: true, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'avatarId', required: false, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ description: 'Liste paginée des messages visibles par l\'actor' })
  listMessages(
    @Req() req: any,
    @Query('tableId') tableId: string,
    @Query() query?: PaginationQueryDto,
    @Query('avatarId') avatarId?: string,
  ) {
    return this.service.listMessages(req.user, tableId, query?.page, query?.limit, avatarId);
  }
}
