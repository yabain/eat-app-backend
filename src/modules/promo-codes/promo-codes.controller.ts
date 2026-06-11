import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PromoCodesService } from './promo-codes.service';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { ValidatePromoCodeDto } from './dto/validate-promo-code.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  PaginatedPromoCodesResponseDto,
  PromoCodeResponseDto,
  PromoCodeValidationResponseDto,
} from './dto/promo-code-response.dto';

@ApiTags('promo-codes')
@Controller('promo-codes')
export class PromoCodesController {
  constructor(private readonly service: PromoCodesService) { }
  @UseGuards(JwtAuthGuard)
  @Post('validate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Valider un code promo' })
  @ApiBody({ type: ValidatePromoCodeDto })
  @ApiOkResponse({ description: 'Résultat validation promo', type: PromoCodeValidationResponseDto })
  validate(@Req() req: any, @Body() body: ValidatePromoCodeDto) {
    return this.service.validateCode(body.code, body.orderAmount, body.restaurantId, req.user?.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister les codes promo' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'WELCOME' })
  @ApiQuery({ name: 'code', required: false, type: String, example: 'WELCOME500' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, example: true })
  @ApiQuery({ name: 'isExpired', required: false, type: Boolean, example: false })
  @ApiOkResponse({
    description: 'Liste paginée des promos (plus récent au plus ancien)',
    type: PaginatedPromoCodesResponseDto,
  })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('code') code?: string,
    @Query('isActive') isActive?: string,
    @Query('isExpired') isExpired?: string,
  ) {
    return this.service.findAll(query.page, query.limit, { q, code, isActive, isExpired });
  }

  @UseGuards(JwtAuthGuard)
  @Get('by-code/:code')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Récupérer un code promo par son code' })
  @ApiParam({ name: 'code', example: 'WELCOME500' })
  @ApiOkResponse({ description: 'Code promo trouvé', type: PromoCodeResponseDto })
  findByCode(@Param('code') code: string) { return this.service.findByCode(code); }

  @UseGuards(JwtAuthGuard)
  @Get('lookup')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Récupérer un code promo par query param' })
  @ApiQuery({ name: 'code', required: true, type: String, example: 'WELCOME500' })
  @ApiOkResponse({ description: 'Code promo trouvé', type: PromoCodeResponseDto })
  findByCodeQuery(@Query('code') code: string) { return this.service.findByCode(code); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Détail d’un code promo' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Code promo trouvé', type: PromoCodeResponseDto })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Créer un code promo' })
  @ApiBody({ type: CreatePromoCodeDto })
  @ApiCreatedResponse({ description: 'Code promo créé', type: PromoCodeResponseDto })
  create(@Body() dto: CreatePromoCodeDto) { return this.service.create(dto); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Modifier un code promo' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdatePromoCodeDto })
  @ApiOkResponse({ description: 'Code promo mis à jour', type: PromoCodeResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdatePromoCodeDto) { return this.service.update(id, dto); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/activate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Activer un code promo' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Code promo activé', type: PromoCodeResponseDto })
  activate(@Param('id') id: string) { return this.service.activate(id); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/deactivate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Désactiver un code promo' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Code promo désactivé', type: PromoCodeResponseDto })
  deactivate(@Param('id') id: string) { return this.service.deactivate(id); }
  
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Supprimer un code promo' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Code promo supprimé', type: PromoCodeResponseDto })
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
