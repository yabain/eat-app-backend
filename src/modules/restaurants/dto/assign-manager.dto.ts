import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class AssignManagerDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f61999' })
  @IsMongoId()
  managerId: string;
}
