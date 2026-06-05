import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../../common/enums/roles.enum';
import { IsCmPhone, NormalizeOptionalCmPhone } from '../../../common/validators/cm-phone.validator';

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ example: 'Paul' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Nana' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: 'paul.employee@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'StrongPwd@123', minLength: 6 })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional({ example: '691224472' })
  @NormalizeOptionalCmPhone()
  @IsOptional()
  @IsString()
  @IsCmPhone()
  phone?: string;

  @ApiPropertyOptional({ enum: [UserRole.EMPLOYEE, UserRole.DRIVER], example: UserRole.EMPLOYEE })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole.EMPLOYEE | UserRole.DRIVER;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Disponibilité pour les utilisateurs livreurs' })
  @IsOptional()
  @IsBoolean()
  isDriverAvailable?: boolean;
}
