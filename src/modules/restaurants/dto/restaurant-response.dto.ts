import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class RestaurantManagerResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiPropertyOptional({ example: 'Flambel' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'SANOU' })
  lastName?: string;

  @ApiPropertyOptional({ example: 'flambel@example.com' })
  email?: string;

  @ApiPropertyOptional({ example: '+237691224472' })
  phone?: string;

  @ApiPropertyOptional({ example: '/uploads/profiles/avatar.png' })
  profileImage?: string;

  @ApiPropertyOptional({ example: 'manager' })
  role?: string;

  @ApiPropertyOptional({ example: true })
  isActive?: boolean;
}

export class RestaurantResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: 'Chez Maman' })
  name: string;

  @ApiProperty({ example: 'chez-maman' })
  slug: string;

  @ApiProperty({ example: false })
  top: boolean;

  @ApiProperty({ example: 1, description: 'Priorité d’affichage publique' })
  order: number;

  @ApiPropertyOptional({ example: true, description: 'Au moins un produit actif, disponible et en stock' })
  hasAvailableItems?: boolean;

  @ApiPropertyOptional({ example: 'Cuisine africaine maison' })
  description?: string;

  @ApiPropertyOptional({ example: '+237612345678' })
  phone1?: string;

  @ApiPropertyOptional({ example: '+237699999999' })
  phone2?: string;

  @ApiPropertyOptional({ example: 'contact@chezmaman.cm' })
  email?: string;

  @ApiPropertyOptional({ example: 'Le goût de la maison' })
  slogang?: string;

  @ApiPropertyOptional({ example: 'Akwa, Douala' })
  localisation?: string;

  @ApiPropertyOptional({ example: '08:00-22:00' })
  ouverture?: string;

  @ApiPropertyOptional({ example: '/uploads/restaurants/logo.png' })
  logo?: string;

  @ApiPropertyOptional({ example: '/uploads/restaurants/banner.png' })
  bannerImage?: string;

  @ApiPropertyOptional({ example: '/uploads/restaurants/cover.png' })
  coverImage?: string;

  @ApiPropertyOptional({ example: '+237612345678' })
  phone?: string;

  @ApiProperty({ enum: ['active', 'inactive'], example: 'active' })
  status: 'active' | 'inactive';

  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', example: '665d58e63d7bfeb8f7f6172e' },
      { $ref: '#/components/schemas/RestaurantManagerResponseDto' },
    ],
    nullable: true,
  })
  managerId?: string | RestaurantManagerResponseDto | null;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-25T12:00:00.000Z' })
  updatedAt?: string;
}

export class RestaurantMediaResponseDto {
  @ApiPropertyOptional({ example: '/uploads/restaurants/logo.png' })
  logo?: string;

  @ApiPropertyOptional({ example: '/uploads/restaurants/banner.png' })
  bannerImage?: string;
}

export class PaginatedRestaurantsResponseDto {
  @ApiProperty({ type: [RestaurantResponseDto] })
  data: RestaurantResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
