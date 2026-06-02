import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DigikuntzWebhookDto } from './dto/digikuntz-webhook.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { OkResponseDto } from '../../common/dto/response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedPaymentsResponseDto, PaymentInitiateResponseDto, PaymentStatusResponseDto, PaymentSyncResponseDto } from './dto/payment-response.dto';

@ApiTags('webhooks')
@Controller('webhook')
export class DigikuntzWebhookController {
  constructor(private readonly service: PaymentsService) {}

  @Post('digikuntz')
  @ApiOperation({
    summary: 'Webhook public DigiKuntz',
    description:
      "Reçoit les notifications de statut des transactions apiCall envoyées par DigiKuntz via l’URL webhookUrl configurée dans la page des clés API. Cette route est exposée sans préfixe /api : /webhook/digikuntz.",
  })
  @ApiQuery({ name: 'token', required: false, description: 'Webhook shared secret optionnel.' })
  @ApiBody({ type: DigikuntzWebhookDto })
  @ApiOkResponse({ description: 'Webhook traité', type: OkResponseDto })
  webhook(@Body() body: DigikuntzWebhookDto, @Query('token') token?: string) {
    return this.service.webhook(body, token, { allowMissingToken: true });
  }
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister les transactions' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'ORD-1713640000000-ABCDE' })
  @ApiQuery({ name: 'status', required: false, enum: PaymentStatus })
  @ApiQuery({ name: 'provider', required: false, type: String, example: 'digikuntz' })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-05-01' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-05-31' })
  @ApiOkResponse({ description: 'Liste paginée des transactions', type: PaginatedPaymentsResponseDto })
  list(
    @Req() req: any,
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.list(req.user, query.page, query.limit, { q, status, provider, from, to });
  }


  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.CLIENT)
  @Post('initiate/:orderId')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Initier le paiement d’une commande' })
  @ApiParam({ name: 'orderId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({
    description: 'Paiement initialisé',
    type: PaymentInitiateResponseDto,
  })
  initiate(@Param('orderId') orderId: string, @Req() req: any) { return this.service.initiate(orderId, req.user); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.CLIENT)
  @Post('sync/:orderRef')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Synchroniser manuellement le statut DigiKuntz d’une commande' })
  @ApiParam({
    name: 'orderRef',
    example: 'ORD-1713640000000-ABCDE',
    description: 'ID MongoDB de la commande ou numéro de commande',
  })
  @ApiOkResponse({
    description: 'Statut de paiement synchronisé depuis DigiKuntz',
    type: PaymentSyncResponseDto,
  })
  sync(@Param('orderRef') orderRef: string, @Req() req: any) {
    return this.service.syncOrderPayment(orderRef, req.user);
  }

  @Post('webhook/digikuntz')
  @ApiOperation({
    summary: 'Webhook DigiKuntz',
    description: 'Reçoit les notifications de statut de paiement de DigiKuntz. Statuts traités : `payin_success` (paiement confirmé), `payin_error` / `payin_closed` (paiement échoué, stock restitué). `payin_pending` est ignoré. Le query param `token` doit correspondre à `DIGIKUNTZ_WEBHOOK_SECRET`. Le payload n\'est pas considéré comme source de vérité : le serveur réinterroge DigiKuntz pour valider le statut et compare le montant avec celui enregistré localement avant toute mise à jour.',
  })
  @ApiQuery({ name: 'token', required: false, description: 'Webhook shared secret (configured via DIGIKUNTZ_WEBHOOK_SECRET).' })
  @ApiBody({ type: DigikuntzWebhookDto })
  @ApiOkResponse({ description: 'Webhook traité', type: OkResponseDto })
  webhook(@Body() body: DigikuntzWebhookDto, @Query('token') token?: string) {
    return this.service.webhook(body, token);
  }


  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Get(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Détail complet d’une transaction' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Transaction trouvée', type: PaymentStatusResponseDto })
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.CLIENT)
  @Get(':orderId/status')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Statut paiement par commande' })
  @ApiParam({ name: 'orderId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({
    description: 'Dernier statut de paiement',
    type: PaymentStatusResponseDto,
  })
  status(@Param('orderId') orderId: string, @Req() req: any) { return this.service.paymentStatus(orderId, req.user); }
}
