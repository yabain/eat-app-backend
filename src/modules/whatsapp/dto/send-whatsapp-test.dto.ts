import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { IsCmPhone, NormalizeRequiredCmPhone } from '../../../common/validators/cm-phone.validator';

export class SendWhatsappTestDto {
  @ApiProperty({ example: '691224472' })
  @NormalizeRequiredCmPhone()
  @IsString()
  @IsCmPhone()
  phone: string;

  @ApiProperty({ example: 'Bonjour, ceci est un test WhatsApp depuis Eat.' })
  @IsString()
  @MinLength(1)
  message: string;
}
