import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname } from 'path';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { UploadsController } from './uploads.controller';
import { UploadStorageService } from './upload-storage.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        storage: diskStorage({
          destination: (req, _file, cb) => {
            try {
              const driver = configService.get<string>('STORAGE_DRIVER', 'local');
              if (driver !== 'local') {
                return cb(new Error(`Unsupported storage driver: ${driver}`), '');
              }

              const rawFolder = req.params?.folder as string | string[] | undefined;
              const folder = Array.isArray(rawFolder) ? rawFolder[0] : rawFolder;
              if (folder && !/^[a-zA-Z0-9_-]+$/.test(folder)) {
                return cb(new Error('Invalid upload folder'), '');
              }

              const baseDir = configService.get<string>('UPLOAD_DIR', 'uploads');
              const target = folder ? join(process.cwd(), baseDir, folder) : join(process.cwd(), baseDir);
              mkdirSync(target, { recursive: true });
              cb(null, target);
            } catch (error) {
              cb(error as Error, '');
            }
          },
          filename: (_req, file, cb) => {
            const unique = `${Date.now()}-${randomUUID()}${extname(file.originalname)}`;
            cb(null, unique);
          },
        }),
        fileFilter: (_req, file, cb) => {
          if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image uploads are allowed'), false);
          }
          cb(null, true);
        },
        limits: { fileSize: 5 * 1024 * 1024 },
      }),
    }),
  ],
  controllers: [UploadsController],
  providers: [UploadStorageService],
})
export class UploadsModule {}
