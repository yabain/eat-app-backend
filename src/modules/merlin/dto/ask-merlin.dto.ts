import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MinLength } from 'class-validator';

export class AskMerlinDto {
  @ApiProperty({ example: 'Quels sont les restaurants ouverts ?', minLength: 1 })
  @IsString()
  @MinLength(1)
  message: string;

  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsOptional()
  @IsMongoId()
  conversationId?: string;
}
