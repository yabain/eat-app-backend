import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BalancesService } from './balances.service';
import { AdminBalanceOperationDto } from './dto/admin-balance-operation.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { UpdateWithdrawalStatusDto } from './dto/update-withdrawal-status.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@ApiTags('balances')
@Controller('balances')
export class BalancesController {
  constructor(private readonly service: BalancesService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.DRIVER)
  @Get('my')
  @ApiOperation({ summary: 'Solde disponible selon le rôle connecté' })
  summary(@Req() req: any) { return this.service.summary(req.user); }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.DRIVER)
  @Get('transactions/my')
  @ApiOperation({ summary: 'Transactions de solde du compte connecté' })
  transactions(@Req() req: any, @Query() query: PaginationQueryDto) {
    return this.service.transactions(req.user, query.page, query.limit);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.DRIVER)
  @Get('withdrawals/my')
  @ApiOperation({ summary: 'Demandes de retrait du compte connecté' })
  withdrawals(@Req() req: any, @Query() query: PaginationQueryDto) {
    return this.service.withdrawals(req.user, query.page, query.limit);
  }

  @Roles(UserRole.MANAGER, UserRole.DRIVER)
  @Post('withdrawals')
  @ApiOperation({ summary: 'Initier une demande de retrait MTN Cameroun' })
  withdraw(@Req() req: any, @Body() dto: CreateWithdrawalDto) { return this.service.createWithdrawal(req.user, dto); }

  @Roles(UserRole.ADMIN)
  @Patch('withdrawals/:id/status')
  @ApiOperation({
    summary: 'Traiter une demande de retrait (admin)',
    description: 'Passe une demande à approved, paid, rejected ou failed. Les statuts rejected/failed recréditent automatiquement le solde concerné une seule fois.',
  })
  updateWithdrawalStatus(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateWithdrawalStatusDto) {
    return this.service.updateWithdrawalStatus(id, dto, req.user);
  }


  @Roles(UserRole.ADMIN)
  @Get('drivers/:driverId')
  @ApiOperation({ summary: 'Consulter le solde d’un livreur (admin)' })
  driverBalance(@Req() req: any, @Param('driverId') driverId: string) {
    return this.service.driverBalance(driverId, req.user);
  }

  @Roles(UserRole.ADMIN)
  @Get('restaurants/:restaurantId')
  @ApiOperation({ summary: 'Consulter le solde d’un restaurant (admin)' })
  restaurantBalance(@Req() req: any, @Param('restaurantId') restaurantId: string) {
    return this.service.restaurantBalance(restaurantId, req.user);
  }

  @Roles(UserRole.ADMIN)
  @Post('drivers/:driverId/credit')
  @ApiOperation({ summary: 'Créditer le solde d’un livreur depuis le solde principal' })
  creditDriver(@Req() req: any, @Param('driverId') driverId: string, @Body() dto: AdminBalanceOperationDto) {
    return this.service.creditDriver(driverId, dto, req.user);
  }

  @Roles(UserRole.ADMIN)
  @Post('drivers/:driverId/debit')
  @ApiOperation({ summary: 'Débiter le solde d’un livreur (admin)' })
  debitDriver(@Req() req: any, @Param('driverId') driverId: string, @Body() dto: AdminBalanceOperationDto) {
    return this.service.debitDriver(driverId, dto, req.user);
  }

  @Roles(UserRole.ADMIN)
  @Post('restaurants/:restaurantId/credit')
  @ApiOperation({ summary: 'Créditer le solde d’un restaurant depuis le solde principal' })
  creditRestaurant(@Req() req: any, @Param('restaurantId') restaurantId: string, @Body() dto: AdminBalanceOperationDto) {
    return this.service.creditRestaurant(restaurantId, dto, req.user);
  }

  @Roles(UserRole.ADMIN)
  @Post('restaurants/:restaurantId/debit')
  @ApiOperation({ summary: 'Débiter le solde d’un restaurant (admin)' })
  debitRestaurant(@Req() req: any, @Param('restaurantId') restaurantId: string, @Body() dto: AdminBalanceOperationDto) {
    return this.service.debitRestaurant(restaurantId, dto, req.user);
  }
}

@ApiTags('balances')
@Controller('balances')
export class BalancesWebhookController {
  constructor(private readonly service: BalancesService) {}

  @Post('withdrawals/:id/webhook/digikuntz')
  @ApiOperation({ summary: 'Webhook DigiKuntz pour actualiser un retrait' })
  processDigikuntzWithdrawalWebhook(
    @Param('id') id: string,
    @Body() payload: any,
    @Query('token') token?: string,
  ) {
    return this.service.processDigikuntzWithdrawalWebhook(id, payload, token);
  }
}
