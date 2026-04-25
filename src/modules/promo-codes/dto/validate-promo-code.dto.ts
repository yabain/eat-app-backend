import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';

export class ValidatePromoCodeDto {
  @ApiProperty({ example: 'WELCOME500' })
  @IsString()
  code: string;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  orderAmount: number;

  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsOptional()
  @IsMongoId()
  restaurantId?: string;
}
