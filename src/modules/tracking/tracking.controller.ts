import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TrackVisitDto } from './dto/track-visit.dto';
import { TrackingService } from './tracking.service';

@ApiTags('tracking')
@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('visit')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Enregistrer une visite de page publique/client' })
  @ApiBody({ type: TrackVisitDto })
  @ApiOkResponse({ description: 'Visite enregistrée ou ignorée' })
  track(@Body() dto: TrackVisitDto, @Req() req: any) {
    return this.trackingService.track(dto, req);
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Statistiques de visites (admin)' })
  @ApiQuery({ name: 'period', required: false, enum: ['day', 'month', 'year'] })
  @ApiQuery({ name: 'date', required: false, type: String, description: 'YYYY-MM-DD pour day, YYYY-MM pour month, YYYY pour year' })
  @ApiOkResponse({ description: 'Statistiques agrégées' })
  stats(@Query('period') period?: 'day' | 'month' | 'year', @Query('date') date?: string) {
    return this.trackingService.stats(period, date);
  }
}
