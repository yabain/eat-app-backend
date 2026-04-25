import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CartMenuItemSummaryDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: 'Coca Cola' })
  name: string;

  @ApiProperty({ example: 500 })
  price: number;

  @ApiPropertyOptional({ example: '/uploads/menus/coca.png' })
  image?: string;
}

export class CartItemResponseDto {
  @ApiProperty({
    oneOf: [
      { type: 'string', example: '665d58e63d7bfeb8f7f6172e' },
      { $ref: '#/components/schemas/CartMenuItemSummaryDto' },
    ],
  })
  menuItemId: string | CartMenuItemSummaryDto;

  @ApiProperty({ example: 2 })
  quantity: number;
}

export class CartResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  userId: string;

  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e', nullable: true })
  restaurantId?: string | null;

  @ApiProperty({ type: [CartItemResponseDto] })
  items: CartItemResponseDto[];
}
