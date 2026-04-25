import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CheckoutFromCartDto {
  @ApiProperty({ example: 'Douala' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'Akwa' })
  @IsString()
  district: string;

  @ApiProperty({ example: 'Rue 123, immeuble bleu, 3e etage' })
  @IsString()
  details: string;

  @ApiPropertyOptional({ example: 'WELCOME500' })
  @IsOptional()
  @IsString()
  promoCode?: string;

  @ApiPropertyOptional({ example: 'Sans piment' })
  @IsOptional()
  @IsString()
  notes?: string;
}
