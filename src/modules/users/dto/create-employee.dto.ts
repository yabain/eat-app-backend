import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../../common/enums/roles.enum';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Paul' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Nana' })
  @IsString()
  lastName: string;

  @ApiProperty({ example: 'paul.employee@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongPwd@123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: '+237612345679' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({ enum: [UserRole.EMPLOYEE, UserRole.DRIVER], example: UserRole.EMPLOYEE })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole.EMPLOYEE | UserRole.DRIVER;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
