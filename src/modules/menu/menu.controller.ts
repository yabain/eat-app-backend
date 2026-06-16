import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { MenuInventoryService } from './menu-inventory.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MenuItemResponseDto, PaginatedMenuItemsResponseDto } from './dto/menu-item-response.dto';

@ApiTags('menu-items')
@Controller('menu-items')
export class MenuController {
  constructor(
    private readonly service: MenuService,
    private readonly inventory: MenuInventoryService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/reset-midnight-stocks')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Déclencher manuellement le reset de stock minuit (admin)',
    description:
      "Exécute immédiatement la même logique que le cron quotidien (`0 0 * * *` Africa/Douala) : met à 0 le stock de tous les menu items des catégories ayant `resetStockAtMidnight=true`. Utile pour vérifier la configuration sans attendre minuit.",
  })
  @ApiOkResponse({
    description: 'Reset stock exécuté',
    schema: {
      example: { matchedCount: 12, modifiedCount: 10, categories: 2 },
    },
  })
  triggerMidnightStockReset() {
    return this.inventory.resetStocksForConfiguredCategories('manual');
  }

  @Post('stock-check')
  @ApiOperation({
    summary: 'Vérifier la disponibilité (sans zone) d\'une liste d\'items du panier',
    description:
      'Retourne la liste des items du panier qui ne sont plus disponibles dans la quantité demandée. Utilisé par le panier pour pré-valider avant le checkout.',
  })
  @ApiBody({
    schema: {
      example: { items: [{ menuItemId: '665d58e63d7bfeb8f7f6172e', quantity: 2 }] },
    },
  })
  @ApiOkResponse({
    description: 'Diagnostic des stocks par item',
    schema: {
      example: {
        items: [
          {
            menuItemId: '665d58e63d7bfeb8f7f6172e',
            name: 'Riz au poulet',
            requested: 2,
            available: 1,
            reason: 'insufficient',
          },
        ],
      },
    },
  })
  stockCheck(@Body() body: { items: Array<{ menuItemId: string; quantity: number }> }) {
    return this.service.stockCheck(body?.items || []);
  }

  @Get('public/:restaurantId')
  @ApiOperation({ summary: 'Lister les items publics d’un restaurant' })
  @ApiParam({ name: 'restaurantId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'coca' })
  @ApiQuery({ name: 'categoryId', required: false, type: String, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({
    description: 'Liste paginée des items disponibles',
    type: PaginatedMenuItemsResponseDto,
  })
  publicByRestaurant(
    @Param('restaurantId') restaurantId: string,
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.service.findPublicByRestaurant(restaurantId, query.page, query.limit, { q, categoryId });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister les menus (admin/manager/employé)' })
  @ApiQuery({ name: 'restaurantId', required: false, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'pizza' })
  @ApiQuery({ name: 'categoryId', required: false, type: String, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'isAvailable', required: false, type: Boolean, example: true })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, example: true })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['name', 'createdAt'] })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({
    description: 'Liste paginée des menus (plus récent au plus ancien)',
    type: PaginatedMenuItemsResponseDto,
  })
  findAll(
    @Query('restaurantId') restaurantId?: string,
    @Query() query?: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('isAvailable') isAvailable?: string,
    @Query('isActive') isActive?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Req() req?: any,
  ) {
    return this.service.findAllForActor(req.user, restaurantId, query?.page, query?.limit, {
      q,
      categoryId,
      isAvailable,
      isActive,
      sortBy,
      sortDir,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Get('manage/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Détail d’un menu item pour gestion, y compris un item en revue' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Menu item trouvé', type: MenuItemResponseDto })
  findOneForActor(@Param('id') id: string, @Req() req: any) {
    return this.service.findOneForActor(req.user, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail public d’un menu item actif' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Menu item trouvé', type: MenuItemResponseDto })
  findOne(@Param('id') id: string) {
    return this.service.findPublicOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Créer un menu item (admin/manager/employé)' })
  @ApiBody({ type: CreateMenuItemDto })
  @ApiCreatedResponse({ description: 'Menu item créé', type: MenuItemResponseDto })
  create(@Body() dto: CreateMenuItemDto, @Req() req: any) {
    return this.service.createForActor(req.user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Modifier un menu item (admin/manager/employé)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateMenuItemDto })
  @ApiOkResponse({ description: 'Menu item mis à jour', type: MenuItemResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateMenuItemDto, @Req() req: any) {
    return this.service.updateForActor(req.user, id, dto);
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id/activate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Valider et activer un menu item (admin/manager)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Menu item activé', type: MenuItemResponseDto })
  activate(@Param('id') id: string, @Req() req: any) {
    return this.service.activateForActor(req.user, id);
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id/deactivate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Désactiver un menu item (admin/manager)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Menu item désactivé', type: MenuItemResponseDto })
  deactivate(@Param('id') id: string, @Req() req: any) {
    return this.service.deactivateForActor(req.user, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Delete(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Supprimer un menu item (admin/manager/employé)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Menu item supprimé', type: MenuItemResponseDto })
  remove(@Param('id') id: string, @Req() req: any) { return this.service.removeForActor(req.user, id); }
}
