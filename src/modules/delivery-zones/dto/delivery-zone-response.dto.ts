import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class DeliveryZoneResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: 'Douala' })
  city: string;

  @ApiProperty({ example: 'Akwa' })
  district: string;

  @ApiPropertyOptional({ example: 'Zone centre-ville, accès rapide' })
  details?: string;

  @ApiProperty({ example: 1500 })
  deliveryFee: number;

  @ApiProperty({ example: 25, description: 'Durée estimée de livraison en minutes' })
  time: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  updatedAt?: string;
}

export class PaginatedDeliveryZonesResponseDto {
  @ApiProperty({ type: [DeliveryZoneResponseDto] })
  data: DeliveryZoneResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
