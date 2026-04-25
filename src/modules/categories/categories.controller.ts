import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CategoryResponseDto, PaginatedCategoriesResponseDto } from './dto/category-response.dto';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}
  @Get()
  @ApiOperation({ summary: 'Lister les catégories' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'boisson' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, example: true })
  @ApiOkResponse({
    description: 'Liste paginée des catégories (plus récent au plus ancien)',
    type: PaginatedCategoriesResponseDto,
  })
  findAll(@Query() query: PaginationQueryDto, @Query('q') q?: string, @Query('isActive') isActive?: string) {
    return this.service.findAll(query.page, query.limit, { q, isActive });
  }
  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une catégorie' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Catégorie trouvée', type: CategoryResponseDto })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Créer une catégorie (admin)' })
  @ApiBody({ type: CreateCategoryDto })
  @ApiCreatedResponse({ description: 'Catégorie créée', type: CategoryResponseDto })
  create(@Body() dto: CreateCategoryDto) { return this.service.create(dto); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Modifier une catégorie (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateCategoryDto })
  @ApiOkResponse({ description: 'Catégorie mise à jour', type: CategoryResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) { return this.service.update(id, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/activate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Activer une catégorie (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Catégorie activée', type: CategoryResponseDto })
  activate(@Param('id') id: string) { return this.service.activate(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/deactivate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Désactiver une catégorie (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Catégorie désactivée', type: CategoryResponseDto })
  deactivate(@Param('id') id: string) { return this.service.deactivate(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Supprimer une catégorie (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Catégorie supprimée', type: CategoryResponseDto })
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
