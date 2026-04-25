import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 3 })
  totalPages: number;

  @ApiProperty({ example: false })
  hasPrevPage: boolean;

  @ApiProperty({ example: true })
  hasNextPage: boolean;
}

export class OkResponseDto {
  @ApiProperty({ example: true })
  ok: boolean;
}

export class DeletedResponseDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f6172e' })
  id: string;

  @ApiProperty({ example: true })
  deleted: boolean;
}

export class UploadResponseDto {
  @ApiProperty({ example: '/uploads/1777028517532-file.png' })
  path: string;

  @ApiProperty({ example: '1777028517532-file.png' })
  filename: string;
}
