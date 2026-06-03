import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class PlatformContactSettingsDto {
  @ApiPropertyOptional({ example: '+237 620 803 178' })
  @IsOptional()
  @IsString()
  supportPhone?: string;

  @ApiPropertyOptional({ example: '+237 620 803 178' })
  @IsOptional()
  @IsString()
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

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ type: PlatformContactSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformContactSettingsDto)
  contact?: PlatformContactSettingsDto;

  @ApiPropertyOptional({ type: [PlatformSocialLinkDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlatformSocialLinkDto)
  socialLinks?: PlatformSocialLinkDto[];
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
