import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Grillades' })
  @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ example: 'Viandes grillees et brochettes' })
  @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: '/uploads/categories/grillades.png' })
  @IsOptional() @IsString() image?: string;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ example: false, description: 'Catégorie affichée par défaut sur la page restaurant' })
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional({
    example: false,
    description: 'Remet le stock des menu items de cette categorie a 0 chaque jour a minuit, heure du Cameroun.',
  })
  @IsOptional() @IsBoolean() resetStockAtMidnight?: boolean;
  @ApiPropertyOptional({
    example: 100,
    minimum: 0,
    description: 'Prélèvement forfaitaire système appliqué à chaque unité vendue dans cette catégorie.',
  })
  @IsOptional() @IsInt() @Min(0) systemFeePerItem?: number;
  @ApiPropertyOptional({
    example: 5,
    minimum: 0,
    description: 'Quantité maximale cumulée des articles de cette catégorie dans une commande. 0 désactive la limite.',
  })
  @IsOptional() @IsInt() @Min(0) maxItemsPerOrder?: number;
}
