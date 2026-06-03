import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SendWhatsappTestDto } from './dto/send-whatsapp-test.dto';
import { WhatsappService } from './whatsapp.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiTags('whatsapp')
@ApiBearerAuth('bearer')
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('status')
  @ApiOperation({ summary: 'Statut de connexion WhatsApp (admin)' })
  @ApiOkResponse({ description: 'Statut de connexion WhatsApp' })
  status() {
    return this.whatsappService.getStatus();
  }

  @Get('qr')
  @ApiOperation({ summary: 'QR code WhatsApp à scanner (admin)' })
  @ApiOkResponse({ description: 'QR code courant si WhatsApp attend une authentification' })
  qr() {
    return this.whatsappService.getQr();
  }

  @Post('reset')
  @ApiOperation({ summary: 'Réinitialiser la connexion WhatsApp (admin)' })
  @ApiOkResponse({ description: 'Session supprimée et nouveau QR demandé' })
  reset() {
    return this.whatsappService.reset();
  }

  @Post('send-test')
  @ApiOperation({ summary: 'Envoyer un message WhatsApp de test (admin)' })
  @ApiBody({ type: SendWhatsappTestDto })
  @ApiOkResponse({ description: 'Message de test envoyé' })
  sendTest(@Body() dto: SendWhatsappTestDto) {
    return this.whatsappService.sendText(dto.phone, dto.message);
  }
}
