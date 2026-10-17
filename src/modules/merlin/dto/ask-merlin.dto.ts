import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AskMerlinDto {
  @ApiProperty({ example: 'Quels sont les restaurants ouverts ?', minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsOptional()
  @IsMongoId()
  conversationId?: string;

  @ApiPropertyOptional({ example: 'eat-2026-10-01-a1b2c3d4e5f6g7h8' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  visitorId?: string;
}