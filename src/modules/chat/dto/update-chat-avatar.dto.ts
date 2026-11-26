import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Champs sociaux optionnels d'un avatar (liens publics). */
export class ChatAvatarSocialUrlsDto {
  @ApiPropertyOptional({ example: 'https://mon-site.cm' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^https?:\/\/\S+$/i, { message: 'URL invalide (http/https absolu requis)' })
  web?: string;

  @ApiPropertyOptional({ example: 'https://facebook.com/mon-profil' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^https?:\/\/\S+$/i, { message: 'URL invalide (http/https absolu requis)' })
  facebook?: string;

  @ApiPropertyOptional({ example: 'https://snapchat.com/add/mon-pseudo' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^https?:\/\/\S+$/i, { message: 'URL invalide (http/https absolu requis)' })
  snapchat?: string;

  @ApiPropertyOptional({ example: 'https://instagram.com/mon-pseudo' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^https?:\/\/\S+$/i, { message: 'URL invalide (http/https absolu requis)' })
  instagram?: string;

  @ApiPropertyOptional({ example: 'https://tiktok.com/@mon-pseudo' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^https?:\/\/\S+$/i, { message: 'URL invalide (http/https absolu requis)' })
  tiktok?: string;

  @ApiPropertyOptional({ example: 'https://linkedin.com/in/mon-profil' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^https?:\/\/\S+$/i, { message: 'URL invalide (http/https absolu requis)' })
  linkedin?: string;
}

export class UpdateChatAvatarDto {
  /** Alphanumérique strict : pas de ponctuation, espaces ni emoji. */
  @ApiPropertyOptional({ example: 'Jean237' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9]+$/, { message: 'pseudo doit être alphanumérique (a-z, A-Z, 0-9)' })
  pseudo?: string;

  @ApiPropertyOptional({ enum: ['M', 'F'] })
  @IsOptional()
  @IsIn(['M', 'F'])
  sex?: 'M' | 'F';

  /** URL absolue ou chemin public /uploads/... (liste d'avatars prédéfinis ou upload). */
  @ApiPropertyOptional({ example: '/uploads/avatars/avatar-m-1.png' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  photoUrl?: string;

  @ApiPropertyOptional({ type: ChatAvatarSocialUrlsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChatAvatarSocialUrlsDto)
  socialUrls?: ChatAvatarSocialUrlsDto;

  /**
   * Avatar persistant (jamais expiré). Accepté seulement pour un utilisateur
   * authentifié (userId tracé) — refus 400 sinon, contrôlé dans le service.
   * Si omis, conserve la valeur actuelle.
   */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isPersistant?: boolean;
}