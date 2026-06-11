import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'fs';
import { resolveUploadDir } from '../../common/utils/upload-dir.util';
import { UserRole } from '../../common/enums/roles.enum';

@Injectable()
export class UploadStorageService {
  constructor(private readonly configService: ConfigService) {}

  private parseFolder(rawFolder?: string | string[]) {
    const folder = Array.isArray(rawFolder) ? rawFolder[0] : rawFolder;
    if (!folder) return '';
    if (!/^[a-zA-Z0-9_-]+$/.test(folder)) {
      throw new BadRequestException('Invalid upload folder');
    }
    return folder;
  }

  private assertLocalDriver() {
    const driver = this.configService.get<string>('STORAGE_DRIVER', 'local');
    if (driver !== 'local') {
      throw new BadRequestException(`Unsupported storage driver: ${driver}`);
    }
  }

  assertUploadAllowed(actor: any, rawFolder?: string | string[]) {
    const folder = this.parseFolder(rawFolder);
    const role = actor?.role;
    const profileFolders = ['', 'profiles', 'profile', 'avatars'];
    const restaurantFolders = ['restaurants', 'restaurant-logos', 'restaurant-banners'];
    const menuFolders = ['menus', 'menu-items', 'products', 'items'];

    if (role === UserRole.ADMIN) return;

    if (profileFolders.includes(folder)) return;

    if (restaurantFolders.includes(folder) && role === UserRole.MANAGER) return;

    if (menuFolders.includes(folder) && [UserRole.MANAGER, UserRole.EMPLOYEE].includes(role)) return;

    throw new BadRequestException('Upload folder not allowed for this user');
  }

  resolveDestination(rawFolder?: string | string[]) {
    this.assertLocalDriver();
    const folder = this.parseFolder(rawFolder);
    const target = resolveUploadDir(folder);
    mkdirSync(target, { recursive: true });
    return target;
  }

  publicPath(filename: string, rawFolder?: string | string[]) {
    const folder = this.parseFolder(rawFolder);
    const relativePath = folder ? `/uploads/${folder}/${filename}` : `/uploads/${filename}`;
    const appUrl = (this.configService.get<string>('APP_URL') || '').replace(/\/+$/, '');
    return appUrl ? `${appUrl}${relativePath}` : relativePath;
  }
}
