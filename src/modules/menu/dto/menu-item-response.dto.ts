import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class MenuItemResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  restaurantId: string;

  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e', nullable: true })
  categoryId?: string | null;

  @ApiProperty({ example: 'Poulet DG' })
  name: string;

  @ApiPropertyOptional({ example: 'Poulet sauté avec plantains' })
  description?: string;

  @ApiPropertyOptional({ example: '/uploads/menus/poulet.png' })
  image?: string;

  @ApiProperty({ example: 3500 })
  price: number;

  @ApiProperty({ example: 200 })
  packagingCost: number;

  @ApiProperty({ example: 25 })
  stock: number;

  @ApiProperty({ example: true })
  isAvailable: boolean;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  updatedAt?: string;
}

export class PaginatedMenuItemsResponseDto {
  @ApiProperty({ type: [MenuItemResponseDto] })
  data: MenuItemResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
