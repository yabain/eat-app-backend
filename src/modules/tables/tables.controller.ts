import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { ListTablesQueryDto } from './dto/list-tables-query.dto';
import { CreateTablePositionDto } from './dto/create-table-position.dto';
import { UpdateTablePositionDto } from './dto/update-table-position.dto';

@ApiTags('tables')
@Controller('tables')
export class TablesController {
  constructor(private readonly service: TablesService) {}

  // ------------------------------------------------------------------
  // Tables
  // ------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Créer une table (admin/manager — manager forcé à son restaurant)' })
  @ApiCreatedResponse({ description: 'Table créée' })
  createTable(@Req() req: any, @Body() dto: CreateTableDto) {
    return this.service.createTable(req.user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Lister les tables (admin : toutes, manager/employee : son restaurant) — ' +
      'positionCount inclus par table',
  })
  @ApiQuery({ name: 'restaurantId', required: false, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ description: 'Liste paginée des tables (avec positionCount)' })
  listTables(@Req() req: any, @Query() query?: ListTablesQueryDto) {
    return this.service.listTables(req.user, query?.restaurantId, query?.page, query?.limit);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Modifier une table (label / isActive) (admin/manager) — isActive: false ' +
      'émet table:deactivated à la room table:<id> (clients yChat déconnectés/redirigés)',
  })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Table mise à jour' })
  updateTable(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.service.updateTable(req.user, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Supprimer une table (admin/manager) — CASCADE : positions + avatars + ' +
      'messages de la table ; émet table:removed à la room table:<id>',
  })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Table supprimée (cascade positions/avatars/messages)' })
  deleteTable(@Req() req: any, @Param('id') id: string) {
    return this.service.deleteTable(req.user, id);
  }

  // ------------------------------------------------------------------
  // Positions (sièges) d'une table
  // ------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':tableId/positions')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Créer une position (siège) sur une table (admin/manager) — label auto ' +
      '« Siège N » si vide ; idQr généré avec retry collision',
  })
  @ApiParam({ name: 'tableId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiCreatedResponse({ description: 'Position créée' })
  createPosition(
    @Req() req: any,
    @Param('tableId') tableId: string,
    @Body() dto: CreateTablePositionDto,
  ) {
    return this.service.createPosition(req.user, tableId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Get(':tableId/positions')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister les positions d\'une table (admin/manager/employee)' })
  @ApiParam({ name: 'tableId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ description: 'Liste paginée des positions' })
  listPositions(
    @Req() req: any,
    @Param('tableId') tableId: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.service.listPositions(req.user, tableId, query?.page, query?.limit);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':tableId/positions/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Modifier une position (label / isActive) (admin/manager)' })
  @ApiParam({ name: 'tableId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Position mise à jour' })
  updatePosition(
    @Req() req: any,
    @Param('tableId') tableId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTablePositionDto,
  ) {
    return this.service.updatePosition(req.user, tableId, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':tableId/positions/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Supprimer une position (admin/manager) — CASCADE : avatars de la ' +
      'position (y compris persistants) + leurs messages ; émet avatar:left ' +
      'pour chaque avatar supprimé',
  })
  @ApiParam({ name: 'tableId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Position supprimée (cascade avatars/messages)' })
  deletePosition(@Req() req: any, @Param('tableId') tableId: string, @Param('id') id: string) {
    return this.service.deletePosition(req.user, tableId, id);
  }

  // NOTE : route QR déclarée avant tout pattern ':id' ambigu (défensif —
  // il n'existe aucune route GET ':id' générique sous positions).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get(':tableId/positions/:id/qr')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'QR code (data URL) + URL de scan de la position (admin/manager)' })
  @ApiParam({ name: 'tableId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: '{ dataUrl, url }' })
  positionQr(@Req() req: any, @Param('tableId') tableId: string, @Param('id') id: string) {
    return this.service.positionQr(req.user, tableId, id);
  }
}
