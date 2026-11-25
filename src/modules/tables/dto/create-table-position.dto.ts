import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTablePositionDto {
  /**
   * Optionnel : si vide/absent, le backend auto-génère « Siège N »
   * (N = nombre de positions de la table + 1 — doublons de label acceptés).
   */
  @ApiPropertyOptional({ example: 'Siège 1', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  /**
   * IGNORÉ : dérivé de la table du path (`/tables/:tableId/positions`).
   * Présent dans le DTO pour compatibilité d'appel, jamais lu par le service.
   */
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsOptional()
  @IsMongoId()
  restaurantId?: string;
}
