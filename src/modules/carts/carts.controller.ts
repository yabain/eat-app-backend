import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartsService } from './carts.service';
import { OkResponseDto } from '../../common/dto/response.dto';
import { CartMenuItemSummaryDto, CartResponseDto } from './dto/cart-response.dto';

@UseGuards(JwtAuthGuard)
@ApiTags('cart')
@ApiExtraModels(CartMenuItemSummaryDto)
@ApiBearerAuth('bearer')
@Controller('cart')
export class CartsController {
  constructor(private readonly service: CartsService) {}

  @Get()
  @ApiOperation({ summary: 'Récupérer mon panier' })
  @ApiOkResponse({
    description: 'Panier utilisateur',
    type: CartResponseDto,
  })
  getMyCart(@Req() req: any) {
    return this.service.getMyCart(req.user.sub);
  }

  @Post('items')
  @ApiOperation({ summary: 'Ajouter un item au panier' })
  @ApiBody({ type: AddCartItemDto })
  @ApiOkResponse({ description: 'Panier mis à jour', type: CartResponseDto })
  addItem(@Req() req: any, @Body() dto: AddCartItemDto) {
    return this.service.addItem(req.user.sub, dto);
  }

  @Patch('items/:menuItemId')
  @ApiOperation({ summary: 'Modifier la quantité d’un item du panier' })
  @ApiParam({ name: 'menuItemId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateCartItemDto })
  @ApiOkResponse({ description: 'Panier mis à jour', type: CartResponseDto })
  updateItem(@Req() req: any, @Param('menuItemId') menuItemId: string, @Body() dto: UpdateCartItemDto) {
    return this.service.updateItem(req.user.sub, menuItemId, dto);
  }

  @Delete('items/:menuItemId')
  @ApiOperation({ summary: 'Retirer un item du panier' })
  @ApiParam({ name: 'menuItemId', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Panier mis à jour', type: CartResponseDto })
  removeItem(@Req() req: any, @Param('menuItemId') menuItemId: string) {
    return this.service.removeItem(req.user.sub, menuItemId);
  }

  @Delete()
  @ApiOperation({ summary: 'Vider le panier' })
  @ApiOkResponse({ description: 'Panier vidé', type: OkResponseDto })
  clear(@Req() req: any) {
    return this.service.clear(req.user.sub);
  }
}
