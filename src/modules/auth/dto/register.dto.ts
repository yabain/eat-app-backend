import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
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
}
