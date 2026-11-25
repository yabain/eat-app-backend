import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTableDto {
  @ApiProperty({ example: 'Table 3', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  /**
   * Requis pour l'admin (table créée pour n'importe quel restaurant — 404 si
   * le restaurant n'existe pas). Ignoré pour le manager : forcé à son propre
   * restaurant par le service.
   */
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsOptional()
  @IsMongoId()
  restaurantId?: string;
}
