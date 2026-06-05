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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { resolveUploadDir } from '../../common/utils/upload-dir.util';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/roles.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateProfileImageDto } from './dto/update-profile-image.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedUsersResponseDto, ProfileImageResponseDto, UserResponseDto } from './dto/user-response.dto';

const profileUploadStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const target = resolveUploadDir('profiles');
    mkdirSync(target, { recursive: true });
    cb(null, target);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${randomUUID()}${extname(file.originalname)}`;
    cb(null, unique);
  },
});

const authenticatedRoles = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.EMPLOYEE,
  UserRole.CLIENT,
  UserRole.DRIVER,
];

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags('users')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private buildProfileImageUrl(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Profile image file is required');
    const relativePath = `/uploads/profiles/${file.filename}`;
    const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    return appUrl ? `${appUrl}${relativePath}` : relativePath;
  }

  @Roles(UserRole.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Lister les utilisateurs (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'junior' })
  @ApiQuery({ name: 'role', required: false, enum: UserRole })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, example: true })
  @ApiQuery({ name: 'isDriverAvailable', required: false, type: Boolean, example: true })
  @ApiQuery({ name: 'restaurantId', required: false, type: String, example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({
    description: 'Liste paginée des utilisateurs (plus récent au plus ancien)',
    type: PaginatedUsersResponseDto,
  })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query('q') q?: string,
    @Query('role') role?: UserRole,
    @Query('isActive') isActive?: string,
    @Query('isDriverAvailable') isDriverAvailable?: string,
    @Query('restaurantId') restaurantId?: string,
  ) {
    return this.usersService.findAll(query.page, query.limit, { q, role, isActive, isDriverAvailable, restaurantId });
  }

  @Roles(UserRole.ADMIN)
  @Get('stats/overview')
  @ApiOperation({ summary: 'Statistiques d’évolution des utilisateurs (admin)' })
  @ApiQuery({ name: 'period', required: false, enum: ['day', 'month', 'year'] })
  @ApiQuery({ name: 'date', required: false, type: String })
  stats(@Query('period') period?: string, @Query('date') date?: string) {
    return this.usersService.stats(period, date);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Créer un utilisateur (admin)' })
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({ description: 'Utilisateur créé', type: UserResponseDto })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Roles(UserRole.MANAGER)
  @Get('employees/my-restaurant')
  @ApiOperation({ summary: 'Lister les employés de mon restaurant (manager)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'q', required: false, type: String, example: 'employe' })
  @ApiOkResponse({
    description: 'Employés du restaurant du manager (paginé)',
    type: PaginatedUsersResponseDto,
  })
  findMyEmployees(@Req() req: any, @Query() query: PaginationQueryDto, @Query('q') q?: string) {
    return this.usersService.findEmployees(req.user, query.page, query.limit, q);
  }

  @Roles(UserRole.MANAGER)
  @Post('employees/my-restaurant')
  @ApiOperation({ summary: 'Créer un employé/livreur pour mon restaurant (manager)' })
  @ApiBody({ type: CreateEmployeeDto })
  @ApiCreatedResponse({ description: 'Employé créé', type: UserResponseDto })
  createEmployee(@Req() req: any, @Body() dto: CreateEmployeeDto) {
    return this.usersService.createEmployee(req.user, dto);
  }

  @Roles(UserRole.MANAGER)
  @Patch('employees/:id')
  @ApiOperation({ summary: 'Mettre à jour un employé/livreur de mon restaurant (manager)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateEmployeeDto })
  @ApiOkResponse({ description: 'Employé mis à jour', type: UserResponseDto })
  updateEmployee(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.usersService.updateEmployee(req.user, id, dto);
  }

  @Roles(...authenticatedRoles)
  @Get('me')
  @ApiOperation({ summary: 'Mon profil utilisateur' })
  @ApiOkResponse({ description: 'Profil utilisateur connecté', type: UserResponseDto })
  me(@Req() req: any) {
    return this.usersService.findOne(req.user.sub);
  }

  @Roles(...authenticatedRoles)
  @Patch('me')
  @ApiOperation({ summary: 'Mettre à jour mon profil utilisateur' })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({ description: 'Profil utilisateur mis à jour', type: UserResponseDto })
  updateMe(@Req() req: any, @Body() dto: UpdateUserDto) {
    return this.usersService.updateForActor(req.user, req.user.sub, dto);
  }

  @Roles(...authenticatedRoles)
  @Get('me/profile-image')
  @ApiOperation({ summary: 'Récupérer mon image de profil' })
  @ApiOkResponse({ description: 'Image de profil actuelle', type: ProfileImageResponseDto })
  getMyProfileImage(@Req() req: any) {
    return this.usersService.getMyProfileImage(req.user.sub);
  }

  @Roles(...authenticatedRoles)
  @Patch('me/profile-image')
  @ApiOperation({ summary: 'Mettre à jour mon image de profil' })
  @ApiBody({ type: UpdateProfileImageDto })
  @ApiOkResponse({ description: 'Profil utilisateur mis à jour', type: UserResponseDto })
  updateMyProfileImage(@Req() req: any, @Body() dto: UpdateProfileImageDto) {
    return this.usersService.updateMyProfileImage(req.user.sub, dto.profileImage);
  }

  @Roles(...authenticatedRoles)
  @Patch('me/profile-image/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: profileUploadStorage,
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'), false);
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  @ApiOperation({ summary: 'Uploader et enregistrer mon image de profil' })
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
  @ApiOkResponse({ description: 'Image de profil uploadée et enregistrée', type: UserResponseDto })
  uploadMyProfileImage(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    const profileImage = this.buildProfileImageUrl(file);
    return this.usersService.updateMyProfileImage(req.user.sub, profileImage);
  }

  @Roles(...authenticatedRoles)
  @Delete('me/profile-image')
  @ApiOperation({ summary: 'Supprimer mon image de profil' })
  @ApiOkResponse({ description: 'Image de profil supprimée', type: UserResponseDto })
  deleteMyProfileImage(@Req() req: any) {
    return this.usersService.deleteMyProfileImage(req.user.sub);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Détail utilisateur (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Utilisateur trouvé', type: UserResponseDto })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Roles(...authenticatedRoles)
  @Patch(':id')
  @ApiOperation({ summary: 'Mettre à jour un utilisateur (admin) ou son propre profil' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({ description: 'Utilisateur mis à jour', type: UserResponseDto })
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateForActor(req.user, id, dto);
  }

  @Roles(...authenticatedRoles)
  @Patch(':id/profile-image')
  @ApiOperation({ summary: 'Mettre à jour une image de profil (admin) ou sa propre image' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiBody({ type: UpdateProfileImageDto })
  @ApiOkResponse({ description: 'Profil utilisateur mis à jour', type: UserResponseDto })
  updateProfileImage(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProfileImageDto) {
    return this.usersService.updateProfileImageForActor(req.user, id, dto.profileImage);
  }

  @Roles(...authenticatedRoles)
  @Patch(':id/profile-image/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: profileUploadStorage,
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are allowed'), false);
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  @ApiOperation({ summary: 'Uploader et enregistrer une image de profil (admin) ou sa propre image' })
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
  @ApiOkResponse({ description: 'Image de profil uploadée et enregistrée', type: UserResponseDto })
  uploadProfileImage(@Req() req: any, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const profileImage = this.buildProfileImageUrl(file);
    return this.usersService.updateProfileImageForActor(req.user, id, profileImage);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/activate')
  @ApiOperation({ summary: 'Activer un utilisateur (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Utilisateur activé', type: UserResponseDto })
  activate(@Param('id') id: string) {
    return this.usersService.activateUser(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Désactiver un utilisateur (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Utilisateur désactivé', type: UserResponseDto })
  deactivate(@Param('id') id: string) {
    return this.usersService.deactivateUser(id);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un utilisateur (admin)' })
  @ApiParam({ name: 'id', example: '665d58e63d7bfeb8f7f6172e' })
  @ApiOkResponse({ description: 'Utilisateur supprimé', type: UserResponseDto })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
