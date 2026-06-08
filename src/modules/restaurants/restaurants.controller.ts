import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { resolveUploadDir } from '../../common/utils/upload-dir.util';
import { RestaurantsService } from './restaurants.service';
import { AssignManagerDto } from './dto/assign-manager.dto';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantMediaDto } from './dto/update-restaurant-media.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { AssignEmployeeDto } from './dto/assign-employee.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  PaginatedRestaurantsResponseDto,
  RestaurantMediaResponseDto,
  RestaurantResponseDto,
} from './dto/restaurant-response.dto';

const restaurantUploadStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const target = resolveUploadDir('restaurants');
    mkdirSync(target, { recursive: true });
    cb(null, target);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${randomUUID()}${extname(file.originalname)}`;
    cb(null, unique);
  },
});

@ApiTags('restaurants')
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly service: RestaurantsService) {}
  @Get('public')
  @ApiOperation({ summary: 'Lister les restaurants publics actifs' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'akwa' })
  @ApiOkResponse({
    description: 'Liste paginée des restaurants publics (plus récent au plus ancien)',
    type: PaginatedRestaurantsResponseDto,
  })
  publicList(@Query() query: PaginationQueryDto, @Query('q') q?: string) { return this.service.findPublic(query.page, query.limit, q); }
  @Get('slug/:slug')
  @ApiOperation({ summary: 'Détail restaurant par slug' })
  @ApiParam({ name: 'slug', example: 'chez-maman' })
  @ApiOkResponse({ description: 'Restaurant trouvé', type: RestaurantResponseDto })
  bySlug(@Param('slug') slug: string) { return this.service.findBySlug(slug); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE)
  @Get('my')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Détail de mon restaurant (manager/employé)' })
  @ApiOkResponse({ description: 'Restaurant du compte connecté', type: RestaurantResponseDto })
  myRestaurant(@Req() req: any) { return this.service.findForStaff(req.user); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister tous les restaurants (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'grill' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive'] })
  @ApiQuery({ name: 'managerId', required: false, type: String, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({
    description: 'Liste paginée des restaurants (plus récent au plus ancien)',
    type: PaginatedRestaurantsResponseDto,
  })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('status') status?: 'active' | 'inactive',
    @Query('managerId') managerId?: string,
  ) {
    return this.service.findAll(query.page, query.limit, { q, status, managerId });
  }
  @Get(':id')
  @ApiOperation({ summary: 'Détail restaurant par id' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Restaurant trouvé', type: RestaurantResponseDto })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Créer un restaurant (admin)' })
  @ApiBody({ type: CreateRestaurantDto })
  @ApiCreatedResponse({ description: 'Restaurant créé', type: RestaurantResponseDto })
  create(@Body() dto: CreateRestaurantDto) { return this.service.create(dto); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Mettre à jour un restaurant (admin ou manager de ce restaurant)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateRestaurantDto })
  @ApiOkResponse({ description: 'Restaurant mis à jour', type: RestaurantResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateRestaurantDto, @Req() req: any) { return this.service.update(id, dto, req.user); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/activate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Activer un restaurant (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Restaurant activé', type: RestaurantResponseDto })
  activate(@Param('id') id: string) { return this.service.activate(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/deactivate')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Désactiver un restaurant (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Restaurant désactivé', type: RestaurantResponseDto })
  deactivate(@Param('id') id: string) { return this.service.deactivate(id); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/media')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Mettre à jour logo et bannière d’un restaurant (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateRestaurantMediaDto })
  @ApiOkResponse({
    description: 'Médias restaurant mis à jour',
    type: RestaurantMediaResponseDto,
  })
  updateMedia(@Param('id') id: string, @Body() dto: UpdateRestaurantMediaDto) { return this.service.updateMedia(id, dto); }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/logo/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: restaurantUploadStorage,
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'), false);
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Uploader et enregistrer le logo du restaurant (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
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
  @ApiOkResponse({ description: 'Logo restaurant mis à jour', type: RestaurantMediaResponseDto })
  uploadLogo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const relativePath = `/uploads/restaurants/${file.filename}`;
    const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    const logo = appUrl ? `${appUrl}${relativePath}` : relativePath;
    return this.service.updateMedia(id, { logo });
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/banner/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: restaurantUploadStorage,
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'), false);
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Uploader et enregistrer la bannière du restaurant (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
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
  @ApiOkResponse({ description: 'Bannière restaurant mise à jour', type: RestaurantMediaResponseDto })
  uploadBanner(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const relativePath = `/uploads/restaurants/${file.filename}`;
    const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    const bannerImage = appUrl ? `${appUrl}${relativePath}` : relativePath;
    return this.service.updateMedia(id, { bannerImage });
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':id/assign-manager')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Assigner un manager à un restaurant (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: AssignManagerDto })
  @ApiOkResponse({ description: 'Manager assigné au restaurant', type: RestaurantResponseDto })
  assignManager(@Param('id') id: string, @Body() dto: AssignManagerDto) { return this.service.assignManager(id, dto); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get(':id/employees')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Lister les employés d’un restaurant' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false, type: String })
  listEmployees(
    @Param('id') id: string,
    @Req() req: any,
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
  ) {
    return this.service.listEmployees(id, req.user, query.page, query.limit, q);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get(':id/staff-candidates')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Rechercher des utilisateurs à affecter au restaurant' })
  @ApiQuery({ name: 'kind', required: true, enum: ['employee', 'manager'] })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  searchStaffCandidates(
    @Param('id') id: string,
    @Req() req: any,
    @Query('kind') kind: 'employee' | 'manager',
    @Query('q') q?: string,
    @Query('limit') limit?: number,
  ) {
    return this.service.searchStaffCandidates(id, req.user, kind, q, limit);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/employees')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Affecter un utilisateur existant comme employé du restaurant' })
  @ApiBody({ type: AssignEmployeeDto })
  assignEmployee(@Param('id') id: string, @Body() dto: AssignEmployeeDto, @Req() req: any) {
    return this.service.assignEmployee(id, dto.userId, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id/employees/:userId')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Retirer un employé du restaurant sans supprimer son compte' })
  removeEmployee(@Param('id') id: string, @Param('userId') userId: string, @Req() req: any) {
    return this.service.removeEmployee(id, userId, req.user);
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Supprimer un restaurant (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Restaurant supprimé', type: RestaurantResponseDto })
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
