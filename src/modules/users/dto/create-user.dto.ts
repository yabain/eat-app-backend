import { IsBoolean, IsEmail, IsEnum, IsMongoId, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../../common/enums/roles.enum';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'Jean' })
  @IsString() firstName: string;
  @ApiProperty({ example: 'Dupont' })
  @IsString() lastName: string;
  @ApiProperty({ example: 'jean@example.com' })
  @IsEmail() email: string;
  @ApiProperty({ example: 'StrongPwd@123', minLength: 6 })
  @IsString() @MinLength(6) password: string;
  @ApiProperty({ example: '+237612345678' })
  @IsString() phone: string;
  @ApiPropertyOptional({ example: '/uploads/profiles/avatar.png' })
  @IsOptional() @IsString() profileImage?: string;
  @ApiProperty({ enum: UserRole, example: UserRole.EMPLOYEE })
  @IsEnum(UserRole) role: UserRole;
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsOptional() @IsMongoId() restaurantId?: string;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
}
