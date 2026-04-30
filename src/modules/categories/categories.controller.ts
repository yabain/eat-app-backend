import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CategoryResponseDto, PaginatedCategoriesResponseDto } from './dto/category-response.dto';

const categoryUploadStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const baseDir = process.env.UPLOAD_DIR || 'uploads';
    const target = join(process.cwd(), baseDir, 'categories');
    mkdirSync(target, { recursive: true });
    cb(null, target);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${randomUUID()}${extname(file.originalname)}`;
    cb(null, unique);
  },
});

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  private buildCategoryImageUrl(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Category image file is required');
    const relativePath = `/uploads/categories/${file.filename}`;
    const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    return appUrl ? `${appUrl}${relativePath}` : relativePath;
  }

  @Get()
  @ApiOperation({ summary: 'Lister les catégories' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'boisson' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, example: true })
  @ApiOkResponse({
    description: 'Liste paginée des catégories (plus récent au plus ancien)',
    type: PaginatedCategoriesResponseDto,
  })
  findAll(@Query() query: PaginationQueryDto, @Query('q') q?: string, @Query('isActive') isActive?: string) {
    return this.service.findAll(query.page, query.limit, { q, isActive });
  }
  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une catégorie' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Catégorie trouvée', type: CategoryResponseDto })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Créer une catégorie (admin)' })
  @ApiBody({ type: CreateCategoryDto })
  @ApiCreatedResponse({ description: 'Catégorie créée', type: CategoryResponseDto })
  create(@Body() dto: CreateCategoryDto) { return this.service.create(dto); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Modifier une catégorie (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateCategoryDto })
  @ApiOkResponse({ description: 'Catégorie mise à jour', type: CategoryResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) { return this.service.update(id, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/image/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: categoryUploadStorage,
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'), false);
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Uploader et enregistrer l’image d’une catégorie (admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({ description: 'Image catégorie uploadée et enregistrée', type: CategoryResponseDto })
  uploadImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const image = this.buildCategoryImageUrl(file);
    return this.service.updateImage(id, image);
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/activate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Activer une catégorie (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Catégorie activée', type: CategoryResponseDto })
  activate(@Param('id') id: string) { return this.service.activate(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/deactivate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Désactiver une catégorie (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Catégorie désactivée', type: CategoryResponseDto })
  deactivate(@Param('id') id: string) { return this.service.deactivate(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Supprimer une catégorie (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Catégorie supprimée', type: CategoryResponseDto })
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
