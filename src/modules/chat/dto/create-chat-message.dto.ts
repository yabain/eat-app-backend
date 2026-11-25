import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateChatMessageDto {
  /** Table du message — doit correspondre à celle de l'avatar émetteur (400 sinon). */
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsMongoId()
  tableId: string;

  /** Avatar émetteur — doit appartenir à l'utilisateur authentifié. */
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsMongoId()
  fromAvatarId: string;

  /** Avatar destinataire ; omis/null = message de groupe (toute la table). */
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e', nullable: true })
  @IsOptional()
  @IsMongoId()
  toAvatarId?: string | null;

  @ApiProperty({ example: 'On commande quoi ?', maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content: string;
}
