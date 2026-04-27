import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { OrderStatus } from '../../common/enums/order-status.enum';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { PreviewOrderDto } from './dto/preview-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CheckoutFromCartDto } from './dto/checkout-from-cart.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { OrderPreviewResponseDto, OrderResponseDto, PaginatedOrdersResponseDto } from './dto/order-response.dto';

@UseGuards(JwtAuthGuard)
@ApiTags('orders')
@ApiBearerAuth('bearer')
@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}
  @Post('preview')
  @ApiOperation({ summary: 'Prévisualiser le prix de la commande' })
  @ApiBody({ type: PreviewOrderDto })
  @ApiOkResponse({
    description: 'Détail de calcul',
    type: OrderPreviewResponseDto,
  })
  preview(@Body() dto: PreviewOrderDto) { return this.service.preview(dto); }
  @Roles(UserRole.CLIENT)
  @UseGuards(RolesGuard)
  @Post('preview-from-cart')
  @ApiOperation({ summary: 'Prévisualiser le prix depuis le panier' })
  @ApiBody({ type: CheckoutFromCartDto })
  @ApiOkResponse({
    description: 'Détail de calcul du panier',
    type: OrderPreviewResponseDto,
  })
  previewFromCart(@Req() req: any, @Body() dto: CheckoutFromCartDto) { return this.service.previewFromCart(req.user.sub, dto); }
  @Roles(UserRole.CLIENT)
  @UseGuards(RolesGuard)
  @Post()
  @ApiOperation({ summary: 'Créer une commande' })
  @ApiBody({ type: PreviewOrderDto })
  @ApiOkResponse({ description: 'Commande créée', type: OrderResponseDto })
  create(@Req() req: any, @Body() dto: PreviewOrderDto) { return this.service.create(req.user.sub, dto); }
  @Roles(UserRole.CLIENT)
  @UseGuards(RolesGuard)
  @Post('from-cart')
  @ApiOperation({ summary: 'Créer une commande depuis le panier (vide le panier si succès)' })
  @ApiBody({ type: CheckoutFromCartDto })
  @ApiOkResponse({ description: 'Commande créée depuis le panier', type: OrderResponseDto })
  createFromCart(@Req() req: any, @Body() dto: CheckoutFromCartDto) { return this.service.createFromCart(req.user.sub, dto); }
  @Roles(UserRole.CLIENT)
  @UseGuards(RolesGuard)
  @Get('my')
  @ApiOperation({ summary: 'Lister mes commandes client' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'ORD-' })
  @ApiQuery({ name: 'orderStatus', required: false, enum: OrderStatus })
  @ApiQuery({ name: 'paymentStatus', required: false, enum: PaymentStatus })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-04-01' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-04-23' })
  @ApiOkResponse({
    description: 'Liste paginée des commandes client (plus récent au plus ancien)',
    type: PaginatedOrdersResponseDto,
  })
  my(
    @Req() req: any,
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('orderStatus') orderStatus?: OrderStatus,
    @Query('paymentStatus') paymentStatus?: PaymentStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.myOrders(req.user.sub, query.page, query.limit, {
      q,
      orderStatus,
      paymentStatus,
      from,
      to,
    });
  }
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.DRIVER)
  @UseGuards(RolesGuard)
  @Get()
  @ApiOperation({ summary: 'Lister les commandes selon rôle (admin/manager/employé/livreur)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'ORD-' })
  @ApiQuery({ name: 'orderStatus', required: false, enum: OrderStatus })
  @ApiQuery({ name: 'paymentStatus', required: false, enum: PaymentStatus })
  @ApiQuery({ name: 'restaurantId', required: false, type: String, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'userId', required: false, type: String, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-04-01' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-04-23' })
  @ApiOkResponse({
    description: 'Liste paginée des commandes selon rôle (plus récent au plus ancien)',
    type: PaginatedOrdersResponseDto,
  })
  restaurantOrders(
    @Req() req: any,
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('orderStatus') orderStatus?: OrderStatus,
    @Query('paymentStatus') paymentStatus?: PaymentStatus,
    @Query('restaurantId') restaurantId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.restaurantOrders(req.user, query.page, query.limit, {
      q,
      orderStatus,
      paymentStatus,
      restaurantId,
      userId,
      from,
      to,
    });
  }
  @Roles(UserRole.ADMIN, UserRole.DRIVER)
  @UseGuards(RolesGuard)
  @Get('ready-for-delivery')
  @ApiOperation({ summary: 'Lister les commandes en cours de traitement (admin/livreur)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'ORD-' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      OrderStatus.PAID,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.ASSIGNED,
      OrderStatus.OUT_FOR_DELIVERY,
    ],
  })
  @ApiQuery({ name: 'restaurantId', required: false, type: String, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-04-01' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-04-23' })
  @ApiOkResponse({
    description: 'Liste paginée des commandes en cours de traitement',
    type: PaginatedOrdersResponseDto,
  })
  readyForDelivery(
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('status') status?: OrderStatus,
    @Query('restaurantId') restaurantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.readyForDelivery(query.page, query.limit, { q, status, restaurantId, from, to });
  }
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.DRIVER, UserRole.CLIENT)
  @UseGuards(RolesGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Détail commande (filtré selon rôle)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Commande trouvée', type: OrderResponseDto })
  findOne(@Param('id') id: string, @Req() req: any) { return this.service.findOneForActor(id, req.user); }
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.DRIVER)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Mettre à jour le statut d’une commande' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateOrderStatusDto })
  @ApiOkResponse({ description: 'Commande mise à jour', type: OrderResponseDto })
  @Patch(':id/status') updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto, @Req() req: any) {
    return this.service.updateStatus(id, dto, req.user);
  }
}
