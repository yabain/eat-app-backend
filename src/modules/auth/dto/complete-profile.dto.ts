import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { IsCmPhone, NormalizeOptionalCmPhone } from '../../../common/validators/cm-phone.validator';

export class CompleteProfileDto {
  @ApiPropertyOptional({ example: 'Jean' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Dupont' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: '691224472' })
  @NormalizeOptionalCmPhone()
  @IsOptional()
  @IsString()
  @IsCmPhone()
  phone?: string;

  @ApiPropertyOptional({ example: '/uploads/profiles/avatar.png' })
  @IsOptional()
  @IsString()
  profileImage?: string;
}
