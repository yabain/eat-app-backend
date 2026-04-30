import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class CreateCategoryDto {
  @ApiProperty({ example: 'Grillades' })
  @IsString() name: string;
  @ApiPropertyOptional({ example: 'Viandes grillees et brochettes' })
  @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: '/uploads/categories/grillades.png' })
  @IsOptional() @IsString() image?: string;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({
    example: false,
    description: 'Remet le stock des menu items de cette categorie a 0 chaque jour a minuit, heure du Cameroun.',
  })
  @IsOptional() @IsBoolean() resetStockAtMidnight?: boolean;
}
