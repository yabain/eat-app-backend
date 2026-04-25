import { IsBoolean, IsMongoId, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
export class UpdateMenuItemDto {
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsOptional() @IsMongoId() restaurantId?: string;
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f61888' })
  @IsOptional() @IsMongoId() categoryId?: string;
  @ApiPropertyOptional({ example: 'Poulet DG' })
  @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ example: 'Poulet, plantain et legumes' })
  @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: '/uploads/menus/poulet-dg.jpg' })
  @IsOptional() @IsString() image?: string;
  @ApiPropertyOptional({ example: 3500, minimum: 0 })
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @ApiPropertyOptional({ example: 200, minimum: 0 })
  @IsOptional() @IsNumber() @Min(0) packagingCost?: number;
  @ApiPropertyOptional({ example: 20, minimum: 0 })
  @IsOptional() @IsNumber() @Min(0) stock?: number;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
}
