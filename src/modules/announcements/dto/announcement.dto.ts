import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { AnnouncementChannel, AnnouncementRecipientGroup } from '../../../database/schemas/announcement.schema';

export class CreateAnnouncementDto {
  @ApiPropertyOptional({ enum: AnnouncementChannel, example: AnnouncementChannel.EMAIL })
  @IsOptional()
  @IsEnum(AnnouncementChannel)
  channel?: AnnouncementChannel;

  @ApiProperty({ example: 'Nouveautés Eat' })
  @IsString()
  subject: string;

  @ApiProperty({ example: '<p>Bonjour {userFirstName}, découvrez nos nouveautés.</p>' })
  @IsString()
  html: string;

  @ApiPropertyOptional({
    enum: AnnouncementRecipientGroup,
    example: AnnouncementRecipientGroup.ALL_CLIENTS,
  })
  @IsOptional()
  @IsEnum(AnnouncementRecipientGroup)
  recipientGroup?: AnnouncementRecipientGroup;

  @ApiPropertyOptional({ example: 'client@example.com; autre@example.com' })
  @IsOptional()
  @IsString()
  recipientEmails?: string;

  @ApiPropertyOptional({ example: '237691224472; 23791224472' })
  @IsOptional()
  @IsString()
  recipientPhones?: string;

  @ApiPropertyOptional({ example: '2026-06-03T14:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class UpdateAnnouncementDto {
  @ApiPropertyOptional({ enum: AnnouncementChannel, example: AnnouncementChannel.EMAIL })
  @IsOptional()
  @IsEnum(AnnouncementChannel)
  channel?: AnnouncementChannel;

  @ApiPropertyOptional({ example: 'Nouveautés Eat' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ example: '<p>Bonjour {userFirstName}, découvrez nos nouveautés.</p>' })
  @IsOptional()
  @IsString()
  html?: string;

  @ApiPropertyOptional({ enum: AnnouncementRecipientGroup })
  @IsOptional()
  @IsEnum(AnnouncementRecipientGroup)
  recipientGroup?: AnnouncementRecipientGroup;

  @ApiPropertyOptional({ example: 'client@example.com; autre@example.com' })
  @IsOptional()
  @IsString()
  recipientEmails?: string;

  @ApiPropertyOptional({ example: '237691224472; 23791224472' })
  @IsOptional()
  @IsString()
  recipientPhones?: string;

  @ApiPropertyOptional({ example: '2026-06-03T14:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
