import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class CategoryResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: 'Boissons' })
  name: string;

  @ApiPropertyOptional({ example: 'Boissons fraîches et jus' })
  description?: string;

  @ApiPropertyOptional({ example: '/uploads/categories/boissons.png' })
  image?: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: false })
  resetStockAtMidnight: boolean;

  @ApiProperty({ example: 100, description: 'Prélèvement système par unité vendue dans cette catégorie' })
  systemFeePerItem: number;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  updatedAt?: string;
}

export class PaginatedCategoriesResponseDto {
  @ApiProperty({ type: [CategoryResponseDto] })
  data: CategoryResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
