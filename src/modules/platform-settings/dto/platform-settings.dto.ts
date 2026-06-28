import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { IsCmPhone, NormalizeOptionalCmPhone } from '../../../common/validators/cm-phone.validator';

export class PlatformContactSettingsDto {
  @ApiPropertyOptional({ example: '691224472' })
  @NormalizeOptionalCmPhone()
  @IsOptional()
  @IsString()
  @IsCmPhone()
  supportPhone?: string;

  @ApiPropertyOptional({ example: '691224472' })
  @NormalizeOptionalCmPhone()
  @IsOptional()
  @IsString()
  @IsCmPhone()
  supportWhatsapp?: string;

  @ApiPropertyOptional({ example: 'support@eat.yaba-in.com' })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: 'Vos repas livrés simplement.' })
  @IsOptional()
  @IsString()
  slogan?: string;
}

export class PlatformSocialLinkDto {
  @ApiPropertyOptional({ example: 'Facebook' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'fa-brands fa-facebook-f' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ example: 'https://facebook.com/eat' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  order?: number;
}

export class PlatformOrderingSettingsDto {
  @ApiPropertyOptional({ example: 7, minimum: 0, maximum: 23, description: 'Heure d\'ouverture des commandes (0-23, fuseau du champ timezone).' })
  @IsOptional()
  @IsNumber()
  startHour?: number;

  @ApiPropertyOptional({ example: 24, minimum: 0, maximum: 24, description: 'Heure de fermeture des commandes (0-24, où 24 = minuit fin de journée).' })
  @IsOptional()
  @IsNumber()
  endHour?: number;

  @ApiPropertyOptional({ example: 'Africa/Douala' })
  @IsOptional()
  @IsString()
  timezone?: string;
}

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ type: PlatformContactSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformContactSettingsDto)
  contact?: PlatformContactSettingsDto;

  @ApiPropertyOptional({ type: PlatformOrderingSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformOrderingSettingsDto)
  ordering?: PlatformOrderingSettingsDto;

  @ApiPropertyOptional({ type: [PlatformSocialLinkDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlatformSocialLinkDto)
  socialLinks?: PlatformSocialLinkDto[];

  @ApiPropertyOptional({ example: true, description: 'Activer/désactiver Merlin' })
  @IsOptional()
  @IsBoolean()
  merlinEnabled?: boolean;
}

export class CreatePartnerDto {
  @ApiProperty({ example: 'Yaba-In' })
  @IsString()
  name: string;

  @ApiProperty({ example: '/uploads/partners/logo.png' })
  @IsString()
  logoUrl: string;

  @ApiPropertyOptional({ example: 'https://yaba-in.com' })
  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  order?: number;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional({ example: 'Yaba-In' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '/uploads/partners/logo.png' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'https://yaba-in.com' })
  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  order?: number;
}

export class CreateTestimonialDto {
  @ApiProperty({ example: 'Mirana Marci' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '3D Designer' })
  @IsOptional()
  @IsString()
  profession?: string;

  @ApiPropertyOptional({ example: '/uploads/testimonials/photo.png' })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiProperty({ example: 'Commande livrée en 25 minutes, plat encore chaud et délicieux.' })
  @IsString()
  comment: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  rating?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  order?: number;
}

export class UpdateTestimonialDto {
  @ApiPropertyOptional({ example: 'Mirana Marci' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '3D Designer' })
  @IsOptional()
  @IsString()
  profession?: string;

  @ApiPropertyOptional({ example: '/uploads/testimonials/photo.png' })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiPropertyOptional({ example: 'Commande livrée en 25 minutes, plat encore chaud et délicieux.' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  rating?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  order?: number;
}
