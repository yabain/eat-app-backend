import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { UpdateChatAvatarDto } from './dto/update-chat-avatar.dto';
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

  // Écran d'accueil yChat (avant connexion) : résolution PUBLIQUE du QR —
  // uniquement le restaurant (nom + logo) et le siège scanné. Aucune session
  // requise : c'est ce qui permet d'afficher « Se connecter pour continuer ».
  @Get('positions/by-qr/:idQr/public')
  @ApiOperation({
    summary:
      'Résoudre un QR sans session (écran d\'accueil yChat) : restaurant + siège, projection minimale',
  })
  @ApiParam({ name: 'idQr', example: 'AbCdEfGh1234' })
  @ApiOkResponse({ description: 'Restaurant (nom + logo) et siège scanné — 404 si QR inconnu/révoqué' })
  findByQrPublic(@Param('idQr') idQr: string) {
    return this.service.findPositionByQrPublic(idQr);
  }

  // NOTE : c'est la seule route `positions` authentifiée restante du chat
  // (pas de conflit de pattern). Session obligatoire (yChat exige une
  // session), aucun rôle requis — c'est la route appelée après le scan du QR
  // par un client connecté.
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

  // UN SEUL handler GET /chat/avatars : NestJS route par ordre de déclaration,
  // deux handlers identiques feraient que seul le premier serait atteint
  // (le second `?restaurantId=` renverrait alors « tableId invalide »).
  // Dispatch par paramètre de requête : tableId → table, restaurantId → restaurant.
  @UseGuards(JwtAuthGuard)
  @Get('avatars')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Lister les avatars non expirés : ?tableId= (avatars de la table, toutes positions) ' +
      'ou ?restaurantId= (avatars du restaurant, toutes tables — bouton « Parcourir »)',
  })
  @ApiQuery({ name: 'tableId', required: false, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'restaurantId', required: false, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Avatars online/offline (table ou restaurant)' })
  listAvatars(
    @Req() req: any,
    @Query('tableId') tableId?: string,
    @Query('restaurantId') restaurantId?: string,
  ) {
    if (tableId) return this.service.listAvatars(req.user, tableId);
    if (restaurantId) return this.service.listAvatarsByRestaurant(req.user, restaurantId);
    throw new BadRequestException('tableId ou restaurantId requis');
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

  /**
   * Supprimer toute une conversation PRIVÉE (les deux sens) entre son avatar
   * et un destinataire — « Mettre le feu aux poudres ». Ne touche jamais aux
   * messages de groupe ni aux autres conversations.
   */
  @UseGuards(JwtAuthGuard)
  @Delete('conversations/:avatarId/:targetAvatarId')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Supprimer une conversation privée (son avatar ⇄ destinataire) : messages des deux sens, socket conversation:deleted',
  })
  @ApiParam({ name: 'avatarId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiParam({ name: 'targetAvatarId', example: '665d58e63d7bfeb8f7f6172f' })
  @ApiOkResponse({ description: 'Conversation supprimée ({ deleted, messagesDeleted })' })
  deleteConversation(
    @Req() req: any,
    @Param('avatarId') avatarId: string,
    @Param('targetAvatarId') targetAvatarId: string,
  ) {
    return this.service.deleteConversation(req.user, avatarId, targetAvatarId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('avatars/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Mettre à jour son avatar (pseudo, sex, photo, socialUrls, isPersistant)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Avatar mis à jour' })
  updateAvatar(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateChatAvatarDto) {
    return this.service.updateAvatar(req.user, id, dto);
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
