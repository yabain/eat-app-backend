import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    example: '665d58e63d7bfeb8f7f61888',
    description: 'Changer l\'accompagnement choisi pour cette ligne de panier. Envoyer null pour le retirer.',
  })
  @IsOptional()
  @IsMongoId()
  accompanimentId?: string | null;
}
