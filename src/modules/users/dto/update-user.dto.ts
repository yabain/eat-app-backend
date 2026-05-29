import { IsBoolean, IsEmail, IsEnum, IsMongoId, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../../common/enums/roles.enum';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Jean' })
  @IsOptional() @IsString() firstName?: string;
  @ApiPropertyOptional({ example: 'Dupont' })
  @IsOptional() @IsString() lastName?: string;
  @ApiPropertyOptional({ example: 'jean@example.com' })
  @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ example: 'StrongPwd@123', minLength: 6 })
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @ApiPropertyOptional({ example: '+237612345678' })
  @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ example: '/uploads/profiles/avatar.png' })
  @IsOptional() @IsString() profileImage?: string;
  @ApiPropertyOptional({ enum: UserRole, example: UserRole.MANAGER })
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e' })
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional() @IsMongoId() restaurantId?: string;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ example: true, description: 'Disponibilité pour les utilisateurs livreurs' })
  @IsOptional() @IsBoolean() isDriverAvailable?: boolean;
}
