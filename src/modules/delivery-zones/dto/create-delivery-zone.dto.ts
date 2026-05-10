import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class CreateDeliveryZoneDto {
  @ApiProperty({ example: 'Douala' })
  @IsString() city: string;
  @ApiProperty({ example: 'Akwa' })
  @IsString() district: string;
  @ApiPropertyOptional({ example: 'Zone centre-ville, accès rapide' })
  @IsOptional() @IsString() details?: string;
  @ApiPropertyOptional({ example: 'https://maps.google.com/?q=5.0,10.0' })
  @IsOptional() @IsString() mapLink?: string;
  @ApiProperty({ example: 1500 })
  @IsNumber() deliveryFee: number;
  @ApiProperty({ example: 25, description: 'Durée estimée de livraison en minutes' })
  @IsNumber() time: number;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
}
