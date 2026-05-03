import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @Get('overview')
  @ApiOperation({ summary: 'Statistiques dashboard selon le rôle' })
  @ApiQuery({ name: 'period', required: false, enum: ['week', 'month', '12m'] })
  @ApiQuery({ name: 'restaurantId', required: false, type: String })
  overview(@Req() req: any, @Query('period') period?: string, @Query('restaurantId') restaurantId?: string) {
    return this.service.overview(req.user, period, restaurantId);
  }
}
