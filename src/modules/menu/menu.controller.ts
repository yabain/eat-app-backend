import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MenuService } from './menu.service';
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
  constructor(private readonly service: MenuService) {}
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
    @Req() req?: any,
  ) {
    return this.service.findAllForActor(req.user, restaurantId, query?.page, query?.limit, {
      q,
      categoryId,
      isAvailable,
      isActive,
    });
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Get(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Détail d’un menu item (admin/manager/employé)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Menu item trouvé', type: MenuItemResponseDto })
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOneForActor(req.user, id);
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
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Patch(':id/activate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Activer un menu item (admin/manager/employé)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Menu item activé', type: MenuItemResponseDto })
  activate(@Param('id') id: string, @Req() req: any) {
    return this.service.activateForActor(req.user, id);
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Patch(':id/deactivate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Désactiver un menu item (admin/manager/employé)' })
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
