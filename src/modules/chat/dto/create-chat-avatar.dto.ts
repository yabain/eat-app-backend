import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
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

export class CreateChatAvatarDto {
  /**
   * Position (siège) scannée — obtenue via GET /chat/positions/by-qr/:idQr.
   * Le `tableId` du chat est dérivé côté backend depuis cette position.
   */
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsMongoId()
  positionId: string;

  /** Alphanumérique strict : pas de ponctuation, espaces ni emoji. */
  @ApiProperty({ example: 'Jean237' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9]+$/, { message: 'pseudo doit être alphanumérique (a-z, A-Z, 0-9)' })
  pseudo: string;

  @ApiProperty({ enum: ['M', 'F'] })
  @IsIn(['M', 'F'])
  sex: 'M' | 'F';

  /** URL absolue ou chemin public /uploads/... (liste d'avatars prédéfinis ou upload). */
  @ApiProperty({ example: '/uploads/avatars/avatar-m-1.png' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  photoUrl: string;

  @ApiPropertyOptional({ type: ChatAvatarSocialUrlsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChatAvatarSocialUrlsDto)
  socialUrls?: ChatAvatarSocialUrlsDto;

  /**
   * Avatar persistant (jamais expiré). Accepté seulement pour un utilisateur
   * authentifié (userId tracé) — refus 400 sinon, contrôlé dans le service.
   */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isPersistant?: boolean;
}
