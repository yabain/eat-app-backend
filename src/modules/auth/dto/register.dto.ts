import { Equals, IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCmPhone, NormalizeRequiredCmPhone } from '../../../common/validators/cm-phone.validator';

export class RegisterDto {
  @ApiProperty({ example: 'Jean' })
  @IsString() firstName: string;
  @ApiProperty({ example: 'Dupont' })
  @IsString() lastName: string;
  @ApiProperty({ example: 'jean@example.com' })
  @IsEmail() email: string;
  @ApiProperty({ example: 'StrongPwd@123', minLength: 6 })
  @IsString() @MinLength(6) password: string;
  @ApiProperty({ example: '691224472' })
  @NormalizeRequiredCmPhone()
  @IsString()
  @IsCmPhone()
  phone: string;
  @ApiPropertyOptional({ example: '/uploads/profiles/avatar.png' })
  @IsOptional() @IsString() profileImage?: string;

  /**
   * L'utilisateur doit explicitement accepter les CGU + politique de
   * confidentialité + politique de livraison. Le backend rejette toute
   * inscription sans cette acceptation explicite (Equals(true) renvoie 400).
   */
  @ApiProperty({
    example: true,
    description: 'Acceptation explicite des CGU, politique de confidentialité et politique de livraison.',
  })
  @IsBoolean()
  @Equals(true, { message: 'Vous devez accepter les conditions générales d’utilisation pour créer un compte.' })
  acceptTerms: boolean;
}
