import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class AssignEmployeeDto {
  @ApiProperty({ example: '665d58e63d7bfeb8f7f61999' })
  @IsMongoId()
  userId: string;
}
