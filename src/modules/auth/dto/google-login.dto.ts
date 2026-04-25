import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'ID token Google obtenu côté client via Google Identity Services, Firebase Auth ou SDK Google Sign-In.',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...',
  })
  @IsString()
  idToken: string;
}
