import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class DeliveryResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  orderId: string;

  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  driverId: string;

  @ApiProperty({
    enum: ['assigned', 'picked_up', 'out_for_delivery', 'delivered', 'failed'],
    example: 'assigned',
  })
  status: 'assigned' | 'picked_up' | 'out_for_delivery' | 'delivered' | 'failed';

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  assignedAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:30:00.000Z' })
  deliveredAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  updatedAt?: string;
}

export class PaginatedDeliveriesResponseDto {
  @ApiProperty({ type: [DeliveryResponseDto] })
  data: DeliveryResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
