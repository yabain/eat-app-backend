import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DigikuntzWebhookDto } from './dto/digikuntz-webhook.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { OkResponseDto } from '../../common/dto/response.dto';
import { PaymentInitiateResponseDto, PaymentStatusResponseDto } from './dto/payment-response.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

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

  @Post('webhook/digikuntz')
  @ApiOperation({ summary: 'Webhook DigiKuntz' })
  @ApiBody({ type: DigikuntzWebhookDto })
  @ApiOkResponse({ description: 'Webhook traité', type: OkResponseDto })
  webhook(@Body() body: DigikuntzWebhookDto) { return this.service.webhook(body); }

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
