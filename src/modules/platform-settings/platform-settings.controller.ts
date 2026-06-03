import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreatePartnerDto, UpdatePartnerDto, UpdatePlatformSettingsDto } from './dto/platform-settings.dto';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('platform-settings')
@Controller('platform-settings')
export class PlatformSettingsController {
  constructor(private readonly settingsService: PlatformSettingsService) {}

  @Get('public')
  @ApiOperation({ summary: 'Récupérer les paramètres publics de la plateforme' })
  @ApiOkResponse({ description: 'Paramètres publics, contacts, réseaux sociaux et partenaires' })
  getPublicSettings() {
    return this.settingsService.getPublicSettings();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('bearer')
  @Get()
  @ApiOperation({ summary: 'Récupérer les paramètres de la plateforme (admin)' })
  @ApiOkResponse({ description: 'Paramètres complets de la plateforme' })
  getAdminSettings() {
    return this.settingsService.getPublicSettings();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('bearer')
  @Patch()
  @ApiOperation({ summary: 'Mettre à jour les paramètres contact et réseaux sociaux (admin)' })
  @ApiBody({ type: UpdatePlatformSettingsDto })
  @ApiOkResponse({ description: 'Paramètres mis à jour' })
  updateSettings(@Body() dto: UpdatePlatformSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('bearer')
  @Post('partners')
  @ApiOperation({ summary: 'Ajouter un partenaire (admin)' })
  @ApiBody({ type: CreatePartnerDto })
  @ApiOkResponse({ description: 'Partenaire ajouté' })
  addPartner(@Body() dto: CreatePartnerDto) {
    return this.settingsService.addPartner(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('bearer')
  @Patch('partners/:partnerId')
  @ApiOperation({ summary: 'Mettre à jour un partenaire (admin)' })
  @ApiParam({ name: 'partnerId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdatePartnerDto })
  @ApiOkResponse({ description: 'Partenaire mis à jour' })
  updatePartner(@Param('partnerId') partnerId: string, @Body() dto: UpdatePartnerDto) {
    return this.settingsService.updatePartner(partnerId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('bearer')
  @Delete('partners/:partnerId')
  @ApiOperation({ summary: 'Supprimer un partenaire (admin)' })
  @ApiParam({ name: 'partnerId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Partenaire supprimé' })
  deletePartner(@Param('partnerId') partnerId: string) {
    return this.settingsService.deletePartner(partnerId);
  }
}
