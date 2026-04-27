import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MenuItemResponseDto } from '../../menu/dto/menu-item-response.dto';
import { RestaurantResponseDto } from '../../restaurants/dto/restaurant-response.dto';

export class CartItemResponseDto {
  @ApiProperty({ type: () => MenuItemResponseDto, description: 'Menu item populé' })
  menuItemId: MenuItemResponseDto;

  @ApiProperty({ example: 2, description: 'Quantité dans le panier' })
  quantity: number;
}

export class CartResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e', description: "ID de l'utilisateur" })
  userId: string;

  @ApiPropertyOptional({ type: () => RestaurantResponseDto, nullable: true, description: 'Restaurant populé (null si panier vide)' })
  restaurantId?: RestaurantResponseDto | null;

  @ApiProperty({ type: [CartItemResponseDto], description: 'Items du panier' })
  items: CartItemResponseDto[];
}
