import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Grillades' })
  @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ example: 'Viandes grillees et brochettes' })
  @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() isActive?: boolean;
}
