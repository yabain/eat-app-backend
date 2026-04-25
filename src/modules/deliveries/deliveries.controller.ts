import { Body, Controller, Get, Patch, Post, Req, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DeliveriesService } from './deliveries.service';
import { AssignDeliveryDto } from './dto/assign-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DeliveryResponseDto, PaginatedDeliveriesResponseDto } from './dto/delivery-response.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags('deliveries')
@ApiBearerAuth('bearer')
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly service: DeliveriesService) {}
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('assign')
  @ApiOperation({ summary: 'Assigner une livraison à un livreur' })
  @ApiBody({ type: AssignDeliveryDto })
  @ApiOkResponse({ description: 'Livraison assignée', type: DeliveryResponseDto })
  assign(@Body() dto: AssignDeliveryDto, @Req() req: any) { return this.service.assign(dto, req.user); }
  @Roles(UserRole.DRIVER)
  @Get('my')
  @ApiOperation({ summary: 'Lister les livraisons du livreur connecté' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'assigned' })
  @ApiQuery({ name: 'status', required: false, type: String, example: 'assigned' })
  @ApiQuery({ name: 'orderId', required: false, type: String, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({
    description: 'Liste paginée des livraisons (plus récent au plus ancien)',
    type: PaginatedDeliveriesResponseDto,
  })
  my(
    @Req() req: any,
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('orderId') orderId?: string,
  ) {
    return this.service.my(req.user.sub, query.page, query.limit, { q, status, orderId });
  }
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Mettre à jour le statut d’une livraison' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateDeliveryStatusDto })
  @ApiOkResponse({ description: 'Livraison mise à jour', type: DeliveryResponseDto })
  @Patch(':id/status') updateStatus(@Param('id') id: string, @Body() dto: UpdateDeliveryStatusDto, @Req() req: any) {
    return this.service.updateStatus(id, dto, req.user);
  }
}
