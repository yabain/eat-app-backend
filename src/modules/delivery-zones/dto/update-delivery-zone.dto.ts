import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
export class UpdateDeliveryZoneDto {
  @ApiPropertyOptional({ example: 'Douala' })
  @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ example: 'Akwa' })
  @IsOptional() @IsString() district?: string;
  @ApiPropertyOptional({ example: 'Zone centre-ville, accès rapide' })
  @IsOptional() @IsString() details?: string;
  @ApiPropertyOptional({ example: 1500 })
  @IsOptional() @IsNumber() deliveryFee?: number;
  @ApiPropertyOptional({ example: 25, description: 'Durée estimée de livraison en minutes' })
  @IsOptional() @IsNumber() time?: number;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
}
