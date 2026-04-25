import { IsArray, IsBoolean, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class CreatePromoCodeDto {
  @ApiProperty({ example: 'WELCOME500' })
  @IsString() code: string;
  @ApiProperty({ example: 500 })
  @IsNumber() amount: number;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional() expirationDate?: Date;
  @ApiPropertyOptional({ example: 100 })
  @IsOptional() @IsNumber() usageLimit?: number;
  @ApiPropertyOptional({ example: 3000 })
  @IsOptional() @IsNumber() minOrderAmount?: number;
  @ApiPropertyOptional({ type: [String], example: ['665d58e63d7bfeb8f7f6172e'] })
  @IsOptional() @IsArray() applicableRestaurantIds?: string[];
}
