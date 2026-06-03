import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SendWhatsappTestDto {
  @ApiProperty({ example: '237691224472' })
  @IsString()
  @MinLength(8)
  phone: string;

  @ApiProperty({ example: 'Bonjour, ceci est un test WhatsApp depuis Eat.' })
  @IsString()
  @MinLength(1)
  message: string;
}
