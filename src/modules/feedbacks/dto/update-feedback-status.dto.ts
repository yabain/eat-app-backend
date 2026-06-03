import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateFeedbackStatusDto {
  @ApiProperty({ example: false, description: 'true = visible publiquement, false = désactivé et visible uniquement par admin' })
  @IsBoolean()
  status: boolean;
}
