import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/response.dto';

export class RestaurantResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  _id: string;

  @ApiProperty({ example: 'Chez Maman' })
  name: string;

  @ApiProperty({ example: 'chez-maman' })
  slug: string;

  @ApiProperty({ example: false })
  top: boolean;

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

  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e', nullable: true })
  managerId?: string | null;

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
