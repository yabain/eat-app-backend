import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditLogsService } from './audit-logs.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@ApiTags('audit-logs')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly service: AuditLogsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister les logs d\'audit (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 30 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'category' })
  @ApiQuery({ name: 'action', required: false, type: String, example: 'category.update' })
  @ApiQuery({ name: 'resourceType', required: false, type: String, example: 'category' })
  @ApiQuery({ name: 'actorId', required: false, type: String, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-05-01' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-05-31' })
  @ApiOkResponse({ description: 'Liste paginée des logs (plus récent au plus ancien)' })
  list(
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('actorId') actorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.list(query.page, query.limit, { q, action, resourceType, actorId, from, to });
  }
}
