import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class LoginDto {
  @ApiProperty({ example: 'jean@example.com ou 691224472' })
  @IsString()
  identifier: string;

  @ApiPropertyOptional({ example: 'jean@example.com', description: 'Compatibilité anciens clients. Utiliser identifier.' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ example: 'StrongPwd@123' })
  @IsString() password: string;
}
