import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token de réinitialisation reçu par email.' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'StrongPwd@123', minLength: 6 })
  @IsString()
  @MinLength(6)
  newPassword: string;
}
