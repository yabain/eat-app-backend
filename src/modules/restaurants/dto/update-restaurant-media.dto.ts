import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateRestaurantMediaDto {
  @ApiPropertyOptional({ example: '/uploads/logos/logo.png' })
  @IsOptional()
  @IsString()
  logo?: string;

  @ApiPropertyOptional({ example: '/uploads/banners/banner.png' })
  @IsOptional()
  @IsString()
  bannerImage?: string;

  @ApiPropertyOptional({ example: '/uploads/covers/cover.png', description: 'Ancien champ, conservé pour compatibilité' })
  @IsOptional()
  @IsString()
  coverImage?: string;
}
