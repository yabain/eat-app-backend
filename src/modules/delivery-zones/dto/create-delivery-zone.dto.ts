import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class CreateDeliveryZoneDto {
  @ApiProperty({ example: 'Douala' })
  @IsString() city: string;
  @ApiProperty({ example: 'Akwa' })
  @IsString() district: string;
  @ApiProperty({ example: 1500 })
  @IsNumber() deliveryFee: number;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
}
