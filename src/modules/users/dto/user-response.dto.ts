import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums/roles.enum';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class UserResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiPropertyOptional({ example: 'Jean' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Dupont' })
  lastName?: string;

  @ApiProperty({ example: 'jean@example.com' })
  email: string;

  @ApiPropertyOptional({ example: '+237612345678' })
  phone?: string;

  @ApiPropertyOptional({ example: '/uploads/profiles/avatar.png' })
  profileImage?: string;

  @ApiProperty({ enum: UserRole, example: UserRole.CLIENT })
  role: UserRole;

  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e', nullable: true })
  restaurantId?: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: true, description: 'Disponibilité pour les utilisateurs livreurs' })
  isDriverAvailable?: boolean;

  @ApiProperty({ enum: ['local', 'google'], example: 'local' })
  authProvider: 'local' | 'google';

  @ApiProperty({ example: true })
  isProfileComplete: boolean;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  updatedAt?: string;
}

export class ProfileImageResponseDto {
  @ApiPropertyOptional({ example: '/uploads/profiles/avatar.png', nullable: true })
  profileImage?: string | null;
}

export class PaginatedUsersResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  data: UserResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
