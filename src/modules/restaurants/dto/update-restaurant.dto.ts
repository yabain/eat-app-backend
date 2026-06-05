import { IsBoolean, IsEmail, IsMongoId, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsCmPhone, NormalizeOptionalCmPhone } from '../../../common/validators/cm-phone.validator';
export class UpdateRestaurantDto {
  @ApiPropertyOptional({ example: 'Chez Maman' })
  @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ example: 'chez-maman' })
  @IsOptional() @IsString() slug?: string;
  @ApiPropertyOptional({ example: false })
  @IsOptional() @IsBoolean() top?: boolean;
  @ApiPropertyOptional({ example: 'Cuisine locale camerounaise' })
  @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: '691224472' })
  @NormalizeOptionalCmPhone()
  @IsOptional() @IsString() @IsCmPhone() phone1?: string;
  @ApiPropertyOptional({ example: '690909090' })
  @NormalizeOptionalCmPhone()
  @IsOptional() @IsString() @IsCmPhone() phone2?: string;
  @ApiPropertyOptional({ example: 'contact@chezmaman.com' })
  @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ example: 'Le goût qui rassemble' })
  @IsOptional() @IsString() slogang?: string;
  @ApiPropertyOptional({ example: 'Douala, Akwa, Rue Joffre' })
  @IsOptional() @IsString() localisation?: string;
  @ApiPropertyOptional({ example: 'Lun-Dim: 08:00-23:00' })
  @IsOptional() @IsString() ouverture?: string;
  @ApiPropertyOptional({ example: '/uploads/logos/logo.png' })
  @IsOptional() @IsString() logo?: string;
  @ApiPropertyOptional({ example: '/uploads/banners/banner.png' })
  @IsOptional() @IsString() bannerImage?: string;
  @ApiPropertyOptional({ example: '/uploads/covers/cover.png' })
  @IsOptional() @IsString() coverImage?: string;
  @ApiPropertyOptional({ example: '691224472' })
  @NormalizeOptionalCmPhone()
  @IsOptional() @IsString() @IsCmPhone() phone?: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive'], example: 'active' })
  @IsOptional() @IsString() status?: 'active' | 'inactive';
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f61999' })
  @IsOptional() @IsMongoId() managerId?: string;
}
