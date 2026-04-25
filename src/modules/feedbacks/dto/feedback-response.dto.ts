import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class FeedbackResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  userId: string;

  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  entityId: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating: number;

  @ApiPropertyOptional({ example: 'Très bon restaurant' })
  comment?: string;

  @ApiProperty({ example: true })
  status: boolean;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  updatedAt?: string;
}

export class FeedbackStatsResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  entityId: string;

  @ApiProperty({ example: 19 })
  totalFeedbacks: number;

  @ApiProperty({ example: 4.5 })
  averageRating: number;

  @ApiProperty({ example: 4.47 })
  averageRaw: number;

  @ApiProperty({ example: '/5' })
  scale: string;
}

export class PaginatedFeedbacksResponseDto {
  @ApiProperty({ type: [FeedbackResponseDto] })
  data: FeedbackResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
