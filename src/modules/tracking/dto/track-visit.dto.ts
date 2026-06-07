import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TrackVisitDto {
  @ApiPropertyOptional({ example: 'visit-event-1780000000000-abcd' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventId?: string;

  @ApiPropertyOptional({ example: '/restaurants/665d58e63d7bfeb8f7f6172e' })
  @IsString()
  @MaxLength(300)
  path: string;

  @ApiPropertyOptional({ example: 'Restaurant Chez Maman' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ example: 'visit_1780000000000_abcd' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  sessionId?: string;
}
