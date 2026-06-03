import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { ListFeedbacksQueryDto } from './dto/list-feedbacks-query.dto';
import { UpdateFeedbackStatusDto } from './dto/update-feedback-status.dto';
import { UpdateMyFeedbackDto } from './dto/update-my-feedback.dto';
import { FeedbacksService } from './feedbacks.service';
import { FeedbackResponseDto, FeedbackStatsResponseDto, PaginatedFeedbacksResponseDto } from './dto/feedback-response.dto';

@ApiTags('feedbacks')
@Controller('feedbacks')
export class FeedbacksController {
  constructor(private readonly service: FeedbacksService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Créer un feedback sur une entité (un seul feedback par utilisateur et par entité)' })
  @ApiBody({ type: CreateFeedbackDto })
  @ApiCreatedResponse({ description: 'Feedback créé', type: FeedbackResponseDto })
  @ApiConflictResponse({ description: 'Un feedback existe déjà pour cet utilisateur et cette entité' })
  create(@Req() req: any, @Body() dto: CreateFeedbackDto) {
    return this.service.createMyFeedback(req.user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('entity/:entityId/my')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Modifier mon feedback pour une entité' })
  @ApiParam({ name: 'entityId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateMyFeedbackDto })
  @ApiOkResponse({ description: 'Feedback mis à jour', type: FeedbackResponseDto })
  updateMyFeedback(@Req() req: any, @Param('entityId') entityId: string, @Body() dto: UpdateMyFeedbackDto) {
    return this.service.updateMyFeedback(req.user.sub, entityId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/status')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Activer ou désactiver un feedback (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateFeedbackStatusDto })
  @ApiOkResponse({ description: 'Statut du feedback mis à jour', type: FeedbackResponseDto })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateFeedbackStatusDto) {
    return this.service.updateFeedbackStatus(id, dto.status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/entity/:entityId')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister tous les feedbacks d’une entité, actifs et désactivés (admin)' })
  @ApiParam({ name: 'entityId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiOkResponse({ description: 'Liste paginée complète des feedbacks', type: PaginatedFeedbacksResponseDto })
  listByEntityForAdmin(@Param('entityId') entityId: string, @Query() query: ListFeedbacksQueryDto) {
    return this.service.listByEntity(entityId, query.page, query.limit, true);
  }

  @Get('entity/:entityId/stats')
  @ApiOperation({ summary: 'Statistiques des feedbacks d’une entité' })
  @ApiParam({ name: 'entityId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({
    description: 'Statistiques de feedback',
    type: FeedbackStatsResponseDto,
  })
  stats(@Param('entityId') entityId: string) {
    return this.service.getEntityStats(entityId);
  }

  @Get('entity/:entityId')
  @ApiOperation({ summary: 'Lister les feedbacks visibles d’une entité (10 par page par défaut, récent vers ancien)' })
  @ApiParam({ name: 'entityId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiOkResponse({
    description: 'Liste paginée des feedbacks visibles',
    type: PaginatedFeedbacksResponseDto,
  })
  listByEntity(@Param('entityId') entityId: string, @Query() query: ListFeedbacksQueryDto) {
    return this.service.listByEntity(entityId, query.page, query.limit);
  }
}
