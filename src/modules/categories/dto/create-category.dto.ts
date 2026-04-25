import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class CreateCategoryDto {
  @ApiProperty({ example: 'Grillades' })
  @IsString() name: string;
  @ApiPropertyOptional({ example: 'Viandes grillees et brochettes' })
  @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
}
