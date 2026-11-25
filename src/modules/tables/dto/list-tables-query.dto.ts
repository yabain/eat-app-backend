import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * GET /tables — pagination + filtre restaurantId optionnel (admin).
 * Le filtre est validé (mongoId) : 400 si invalide — le scoping réel
 * (manager/employee forcés à leur restaurant) est appliqué par le service.
 */
export class ListTablesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '665d58e63d7bfeb8f7f6172e' })
  @IsOptional()
  @IsMongoId()
  restaurantId?: string;
}
