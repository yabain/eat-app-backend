import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UpdateProfileImageDto {
  @ApiProperty({ example: '/uploads/profiles/avatar.png' })
  @IsString()
  profileImage: string;
}
