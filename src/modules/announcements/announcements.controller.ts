import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AnnouncementStatus } from '../../database/schemas/announcement.schema';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcement.dto';
import { AnnouncementsService } from './announcements.service';
import { resolveUploadDir } from '../../common/utils/upload-dir.util';

const announcementAttachmentStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const destination = resolveUploadDir('announcements');
    mkdirSync(destination, { recursive: true });
    cb(null, destination);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname).toLowerCase()}`);
  },
});

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiTags('announcements')
@ApiBearerAuth('bearer')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Post('attachment')
  @UseInterceptors(FileInterceptor('file', {
    storage: announcementAttachmentStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ];
      const accepted = allowed.includes(file.mimetype);
      cb(accepted ? null : new Error('Unsupported attachment type'), accepted);
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Importer une pièce jointe pour une annonce' })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  uploadAttachment(@UploadedFile() file: Express.Multer.File) {
    return this.announcementsService.buildAttachmentMetadata(file);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les annonces envoyées ou programmées (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: AnnouncementStatus })
  @ApiOkResponse({ description: 'Liste paginée des annonces' })
  list(@Query() query: PaginationQueryDto, @Query('status') status?: AnnouncementStatus) {
    return this.announcementsService.list(query.page, query.limit, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail annonce (admin)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Annonce trouvée' })
  findOne(@Param('id') id: string) {
    return this.announcementsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Créer une annonce en brouillon ou programmée (admin)' })
  @ApiBody({ type: CreateAnnouncementDto })
  @ApiOkResponse({ description: 'Annonce créée' })
  create(@Req() req: any, @Body() dto: CreateAnnouncementDto) {
    return this.announcementsService.create(req.user, dto, false);
  }

  @Post('send')
  @ApiOperation({ summary: 'Créer et envoyer immédiatement une annonce (admin)' })
  @ApiBody({ type: CreateAnnouncementDto })
  @ApiOkResponse({ description: 'Annonce envoyée' })
  createAndSend(@Req() req: any, @Body() dto: CreateAnnouncementDto) {
    return this.announcementsService.create(req.user, dto, true);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une annonce brouillon ou programmée (admin)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: UpdateAnnouncementDto })
  @ApiOkResponse({ description: 'Annonce modifiée' })
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcementsService.update(id, dto);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Envoyer immédiatement une annonce existante (admin)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Annonce envoyée' })
  send(@Param('id') id: string) {
    return this.announcementsService.sendAnnouncement(id);
  }

  @Post(':id/retry-failed')
  @ApiOperation({
    summary: 'Relancer uniquement les destinataires en échec d’une annonce',
    description: 'Les destinataires ayant déjà reçu l’annonce ne sont pas recontactés.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Les envois en échec ont été remis en file d’attente' })
  retryFailed(@Param('id') id: string) {
    return this.announcementsService.retryFailedDeliveries(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer une annonce (admin)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Annonce supprimée' })
  delete(@Param('id') id: string) {
    return this.announcementsService.delete(id);
  }
}
