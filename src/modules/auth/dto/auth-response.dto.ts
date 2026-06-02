import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums/roles.enum';

export class AuthUserResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  id: string;

  @ApiProperty({ example: 'jean@example.com' })
  email: string;

  @ApiPropertyOptional({ example: 'Jean', nullable: true })
  firstName?: string | null;

  @ApiPropertyOptional({ example: 'Dupont', nullable: true })
  lastName?: string | null;

  @ApiPropertyOptional({ example: '+237612345678', nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ example: '/uploads/profiles/avatar.png', nullable: true })
  profileImage?: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ enum: UserRole, example: UserRole.CLIENT })
  role: UserRole;

  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e', nullable: true })
  restaurantId?: string | null;

  @ApiProperty({ enum: ['local', 'google'], example: 'google' })
  authProvider: 'local' | 'google';

  @ApiProperty({ example: false })
  isProfileComplete: boolean;
}

export class AuthResponseDto {
  @ApiProperty({ example: 'jwt_token' })
  accessToken: string;

  @ApiProperty({
    description: 'Alias compatible DigiKuntz du JWT retourné dans accessToken.',
    example: 'jwt_token',
  })
  token: string;

  @ApiProperty({ type: AuthUserResponseDto })
  user: AuthUserResponseDto;

  @ApiProperty({
    description: 'true lorsque le frontend doit afficher l’écran de complétion du profil.',
    example: true,
  })
  requiresProfileCompletion: boolean;

  @ApiProperty({
    description: 'Champs utilisateur requis mais absents pour finaliser le profil.',
    example: ['phone'],
    type: [String],
  })
  missingProfileFields: string[];
}
