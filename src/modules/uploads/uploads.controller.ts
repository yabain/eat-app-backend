import { Controller, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { UploadStorageService } from './upload-storage.service';
import { UploadResponseDto } from '../../common/dto/response.dto';

@ApiTags('uploads')
@ApiBearerAuth('bearer')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: UploadStorageService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({ description: 'Fichier uploadé', type: UploadResponseDto })
  uploadRoot(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    this.storage.assertUploadAllowed(req.user);
    const path = this.storage.publicPath(file.filename);
    return { path, filename: file.filename };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':folder')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'folder', example: 'menus' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({ description: 'Fichier uploadé dans un dossier', type: UploadResponseDto })
  uploadInFolder(@Req() req: any, @Param('folder') folder: string, @UploadedFile() file: Express.Multer.File) {
    this.storage.assertUploadAllowed(req.user, folder);
    const path = this.storage.publicPath(file.filename, folder);
    return { path, filename: file.filename };
  }
}
