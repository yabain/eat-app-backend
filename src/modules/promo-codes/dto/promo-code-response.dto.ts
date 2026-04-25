import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class PromoCodeResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: 'WELCOME500' })
  code: string;

  @ApiProperty({ example: 500 })
  amount: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  expirationDate?: string;

  @ApiPropertyOptional({ example: 100 })
  usageLimit?: number;

  @ApiProperty({ example: 12 })
  usedCount: number;

  @ApiPropertyOptional({ example: 5000 })
  minOrderAmount?: number;

  @ApiPropertyOptional({ example: ['665d58e63d7bfeb8f7f6172e'], type: [String] })
  applicableRestaurantIds?: string[];

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  updatedAt?: string;
}

export class PromoCodeValidationResponseDto {
  @ApiProperty({ example: true })
  valid: boolean;

  @ApiPropertyOptional({ example: 500 })
  amount?: number;

  @ApiPropertyOptional({ example: 'WELCOME500' })
  code?: string;

  @ApiPropertyOptional({ example: 'Promo code expired' })
  reason?: string;
}

export class PaginatedPromoCodesResponseDto {
  @ApiProperty({ type: [PromoCodeResponseDto] })
  data: PromoCodeResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
