import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'fs';
import { join } from 'path';

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

  resolveDestination(rawFolder?: string | string[]) {
    this.assertLocalDriver();
    const baseDir = this.configService.get<string>('UPLOAD_DIR', 'uploads');
    const folder = this.parseFolder(rawFolder);
    const target = folder ? join(process.cwd(), baseDir, folder) : join(process.cwd(), baseDir);
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
