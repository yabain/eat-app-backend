import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreateProspectDto, UpdateProspectDto } from './dto/prospect.dto';
import { ProspectsService } from './prospects.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiTags('prospects')
@ApiBearerAuth('bearer')
@Controller('prospects')
export class ProspectsController {
  constructor(private readonly prospectsService: ProspectsService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les prospects (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiOkResponse({ description: 'Liste paginée des prospects' })
  list(@Query() query: PaginationQueryDto, @Query('q') q?: string) {
    return this.prospectsService.list(query.page, query.limit, q);
  }

  @Post()
  @ApiOperation({ summary: 'Ajouter un prospect (admin)' })
  @ApiBody({ type: CreateProspectDto })
  @ApiOkResponse({ description: 'Prospect ajouté' })
  create(@Body() dto: CreateProspectDto) {
    return this.prospectsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un prospect (admin)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: UpdateProspectDto })
  @ApiOkResponse({ description: 'Prospect modifié' })
  update(@Param('id') id: string, @Body() dto: UpdateProspectDto) {
    return this.prospectsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un prospect (admin)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Prospect supprimé' })
  delete(@Param('id') id: string) {
    return this.prospectsService.delete(id);
  }
}
