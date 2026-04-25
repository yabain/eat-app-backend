import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DigikuntzWebhookDto {
  @ApiProperty({ example: 'DK-3b77f9a12ce1' })
  @IsString()
  providerRef: string;

  @ApiProperty({ example: 'paid' })
  @IsString()
  status: string;

  @ApiPropertyOptional({ example: 'Webhook payload brut du provider' })
  @IsOptional()
  raw?: any;
}
