import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BalancesService } from './balances.service';
import { CreditDriverDto } from './dto/credit-driver.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

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

  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.DRIVER)
  @Post('withdrawals')
  @ApiOperation({ summary: 'Initier une demande de retrait MTN Cameroun' })
  withdraw(@Req() req: any, @Body() dto: CreateWithdrawalDto) { return this.service.createWithdrawal(req.user, dto); }

  @Roles(UserRole.ADMIN)
  @Post('drivers/:driverId/credit')
  @ApiOperation({ summary: 'Créditer le solde d’un livreur depuis le solde principal' })
  creditDriver(@Req() req: any, @Param('driverId') driverId: string, @Body() dto: CreditDriverDto) {
    return this.service.creditDriver(driverId, dto, req.user);
  }
}
