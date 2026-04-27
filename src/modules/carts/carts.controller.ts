import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartsService } from './carts.service';
import { OkResponseDto } from '../../common/dto/response.dto';
import { CartItemResponseDto, CartResponseDto } from './dto/cart-response.dto';
import { MenuItemResponseDto } from '../menu/dto/menu-item-response.dto';
import { RestaurantResponseDto } from '../restaurants/dto/restaurant-response.dto';

@UseGuards(JwtAuthGuard)
@ApiTags('cart')
@ApiExtraModels(CartResponseDto, CartItemResponseDto, MenuItemResponseDto, RestaurantResponseDto, AddCartItemDto, UpdateCartItemDto)
@ApiBearerAuth('bearer')
@Controller('cart')
export class CartsController {
  constructor(private readonly service: CartsService) {}

  @Get()
  @ApiOperation({
    summary: 'Récupérer mon panier',
    description: "Retourne le panier de l'utilisateur connecté. Chaque item contient le menu item populé.",
  })
  @ApiOkResponse({ description: "Panier de l'utilisateur avec les menu items populés", type: CartResponseDto })
  getMyCart(@Req() req: any) {
    return this.service.getMyCart(req.user.sub);
  }

  @Post('items')
  @ApiOperation({
    summary: 'Ajouter un item au panier',
    description: 'Ajoute un menu item au panier. Tous les items doivent appartenir au même restaurant.',
  })
  @ApiBody({ type: AddCartItemDto, description: 'ID du menu item et quantité souhaitée' })
  @ApiOkResponse({ description: 'Panier mis à jour avec le nouvel item', type: CartResponseDto })
  addItem(@Req() req: any, @Body() dto: AddCartItemDto) {
    return this.service.addItem(req.user.sub, dto);
  }

  @Patch('items/:menuItemId')
  @ApiOperation({
    summary: "Modifier la quantité d'un item du panier",
    description: "Met à jour la quantité d'un item existant dans le panier.",
  })
  @ApiParam({ name: 'menuItemId', description: 'ID MongoDB du menu item', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateCartItemDto, description: "Nouvelle quantité (remplace l'ancienne)" })
  @ApiOkResponse({ description: 'Panier mis à jour', type: CartResponseDto })
  updateItem(@Req() req: any, @Param('menuItemId') menuItemId: string, @Body() dto: UpdateCartItemDto) {
    return this.service.updateItem(req.user.sub, menuItemId, dto);
  }

  @Delete('items/:menuItemId')
  @ApiOperation({
    summary: 'Retirer un item du panier',
    description: 'Supprime un item du panier. Si le panier devient vide, restaurantId est remis à null.',
  })
  @ApiParam({ name: 'menuItemId', description: 'ID MongoDB du menu item à retirer', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: "Panier mis à jour sans l'item supprimé", type: CartResponseDto })
  removeItem(@Req() req: any, @Param('menuItemId') menuItemId: string) {
    return this.service.removeItem(req.user.sub, menuItemId);
  }

  @Delete()
  @ApiOperation({
    summary: 'Vider le panier',
    description: 'Supprime tous les items du panier et remet restaurantId à null.',
  })
  @ApiOkResponse({ description: 'Panier vidé avec succès', type: OkResponseDto })
  clear(@Req() req: any) {
    return this.service.clear(req.user.sub);
  }
}
