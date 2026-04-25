import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DeliveryZonesService } from './delivery-zones.service';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DeliveryZoneResponseDto, PaginatedDeliveryZonesResponseDto } from './dto/delivery-zone-response.dto';

@ApiTags('delivery-zones')
@Controller('delivery-zones')
export class DeliveryZonesController {
  constructor(private readonly service: DeliveryZonesService) {}
  @Get('public')
  @ApiOperation({ summary: 'Lister les zones actives' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'douala' })
  @ApiOkResponse({
    description: 'Zones de livraison actives (paginé)',
    type: PaginatedDeliveryZonesResponseDto,
  })
  active(@Query() query: PaginationQueryDto, @Query('q') q?: string) { return this.service.findActive(query.page, query.limit, q); }
  @Get('lookup')
  @ApiOperation({ summary: 'Trouver le tarif par ville/quartier' })
  @ApiQuery({ name: 'city', example: 'Douala' })
  @ApiQuery({ name: 'district', example: 'Akwa' })
  @ApiOkResponse({ description: 'Zone trouvée', type: DeliveryZoneResponseDto })
  byCityDistrict(@Query('city') city: string, @Query('district') district: string) {
    return this.service.findByCityDistrict(city, district);
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Détail zone de livraison (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Zone trouvée', type: DeliveryZoneResponseDto })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister toutes les zones (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'akwa' })
  @ApiQuery({ name: 'city', required: false, type: String, example: 'Douala' })
  @ApiQuery({ name: 'district', required: false, type: String, example: 'Akwa' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, example: true })
  @ApiOkResponse({
    description: 'Liste paginée des zones (plus récent au plus ancien)',
    type: PaginatedDeliveryZonesResponseDto,
  })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('city') city?: string,
    @Query('district') district?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.service.findAll(query.page, query.limit, { q, city, district, isActive });
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Créer une zone de livraison (admin)' })
  @ApiBody({ type: CreateDeliveryZoneDto })
  @ApiCreatedResponse({ description: 'Zone créée', type: DeliveryZoneResponseDto })
  create(@Body() dto: CreateDeliveryZoneDto) { return this.service.create(dto); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Modifier une zone de livraison (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateDeliveryZoneDto })
  @ApiOkResponse({ description: 'Zone mise à jour', type: DeliveryZoneResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateDeliveryZoneDto) { return this.service.update(id, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/activate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Activer une zone de livraison (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Zone activée', type: DeliveryZoneResponseDto })
  activate(@Param('id') id: string) { return this.service.activate(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/deactivate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Désactiver une zone de livraison (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Zone désactivée', type: DeliveryZoneResponseDto })
  deactivate(@Param('id') id: string) { return this.service.deactivate(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Supprimer une zone de livraison (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Zone supprimée', type: DeliveryZoneResponseDto })
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
