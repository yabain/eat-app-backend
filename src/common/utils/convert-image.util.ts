import { BadRequestException, Logger, UnsupportedMediaTypeException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, extname, join, resolve } from 'path';

// sharp is CommonJS (`export =`) and this project has esModuleInterop disabled.
// A default import would compile to `require('sharp').default` and be undefined.
const sharp = require('sharp') as typeof import('sharp').default;

const CONVERTIBLE_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

const ANIMATED_MIME = new Set(['image/gif', 'image/webp']);
const MAX_IMAGE_PIXELS = 25_000_000;
const MAX_ANIMATION_FRAMES = 30;
const MAX_ANIMATION_PIXELS = 16_000_000;
const logger = new Logger('ConvertImageUtil');

export function isConvertibleImageMime(mimetype: string): boolean {
  const mime = String(mimetype || '').toLowerCase();
  return mime === 'image/gif' || CONVERTIBLE_MIME[mime] !== undefined;
}

export function assertImageWithinLimits(
  metadata: { width?: number; height?: number; pages?: number } | undefined,
  animated: boolean,
) {
  const width = Number(metadata?.width || 0);
  const height = Number(metadata?.height || 0);
  if (!width || !height) {
    throw new BadRequestException('Unable to read the uploaded image dimensions');
  }

  const pixels = width * height;
  if (pixels > MAX_IMAGE_PIXELS) {
    throw new BadRequestException('Image dimensions are too large');
  }

  if (animated) {
    const pages = Math.max(1, Number(metadata?.pages || 1));
    if (pages > MAX_ANIMATION_FRAMES || pages * pixels > MAX_ANIMATION_PIXELS) {
      throw new BadRequestException('Animated image is too large');
    }
  }
}

async function unlinkQuietly(filePath: string): Promise<string | null> {
  try {
    await fs.unlink(filePath);
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    return (error as Error)?.message || String(error);
  }
}

function webpFilenameFor(filename: string): string {
  const extension = extname(filename);
  const base = extension ? filename.slice(0, -extension.length) : filename;
  return `${base}.webp`;
}

function uniqueWebpFilename(filename: string): string {
  const extension = extname(filename) || '.webp';
  const base = filename.slice(0, -extension.length);
  return `${base}-${randomUUID()}${extension}`;
}

async function removeRejectedUpload(filePath: string, reason: string) {
  const cleanupError = await unlinkQuietly(filePath);
  if (cleanupError) logger.warn(`Unable to delete ${reason} ${basename(filePath)}: ${cleanupError}`);
}

export async function convertUploadToWebp(
  filePath: string,
  filename: string,
  mimetype: string,
  uploadDir: string,
): Promise<{ path: string; filename: string }> {
  const mime = String(mimetype || '').toLowerCase();

  if (!mime.startsWith('image/')) {
    await removeRejectedUpload(filePath, 'rejected upload');
    throw new UnsupportedMediaTypeException('Only image uploads are allowed');
  }

  if (mime === 'image/svg+xml' || mime === 'image/svg') {
    await removeRejectedUpload(filePath, 'rejected SVG');
    throw new UnsupportedMediaTypeException('SVG images are not allowed');
  }

  if (!isConvertibleImageMime(mime)) {
    await removeRejectedUpload(filePath, 'unsupported image');
    throw new UnsupportedMediaTypeException('Unsupported image type');
  }

  // Derive the final name first. If it would overwrite the source (a WebP
  // upload, or a file named ".webp" whose content is another format), add a
  // unique suffix instead of relying on rename/unlink ordering.
  const preferredFilename = webpFilenameFor(filename);
  const preferredPath = join(uploadDir, preferredFilename);
  const collision = resolve(preferredPath).toLowerCase() === resolve(filePath).toLowerCase();
  const finalFilename = collision ? uniqueWebpFilename(preferredFilename) : preferredFilename;
  const finalPath = join(uploadDir, finalFilename);

  const animated = ANIMATED_MIME.has(mime);
  let metadata: { width?: number; height?: number; pages?: number };
  try {
    metadata = await sharp(filePath, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      limitInputChannels: 4,
    }).metadata();
    assertImageWithinLimits(metadata, animated);
  } catch (error) {
    await removeRejectedUpload(filePath, 'unreadable image');
    logger.warn(
      `Image validation failed for ${basename(filePath)} (${mime}): ${(error as Error)?.message || error}`,
    );
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Unable to process the uploaded image');
  }

  const writePath = join(uploadDir, `${finalFilename}.${randomUUID()}.tmp`);

  try {
    const options = animated
      ? {
          animated: true,
          pages: Math.max(1, Math.min(Number(metadata.pages || 1), MAX_ANIMATION_FRAMES)),
          limitInputPixels: MAX_IMAGE_PIXELS,
          limitInputChannels: 4,
        }
      : {
          limitInputPixels: MAX_IMAGE_PIXELS,
          limitInputChannels: 4,
        };

    // Auto-orient every format, not only HEIC: once conversion runs, EXIF
    // orientation must be applied or phone photos are stored sideways.
    await sharp(filePath, options).rotate().webp({ quality: 82 }).toFile(writePath);
  } catch (error) {
    const tempCleanupError = await unlinkQuietly(writePath);
    const originalCleanupError = await unlinkQuietly(filePath);

    logger.warn(
      `WebP conversion failed for ${basename(filePath)} (${mime}): ${(error as Error)?.message || error}`,
    );
    if (tempCleanupError) logger.warn(`Unable to delete temporary file ${basename(writePath)}: ${tempCleanupError}`);
    if (originalCleanupError) logger.warn(`Unable to delete original upload ${basename(filePath)}: ${originalCleanupError}`);

    throw new BadRequestException('Unable to convert the uploaded image to WebP');
  }

  try {
    await fs.rename(writePath, finalPath);
  } catch (error) {
    const tempCleanupError = await unlinkQuietly(writePath);
    const originalCleanupError = await unlinkQuietly(filePath);
    logger.error(
      `Unable to finalize WebP file for ${basename(filePath)} (${mime}): ${(error as Error)?.message || error}`,
    );
    if (tempCleanupError) logger.warn(`Unable to delete temporary file ${basename(writePath)}: ${tempCleanupError}`);
    if (originalCleanupError) logger.warn(`Unable to delete original upload ${basename(filePath)}: ${originalCleanupError}`);
    throw new BadRequestException('Unable to save the converted image');
  }

  const cleanupError = await unlinkQuietly(filePath);
  if (cleanupError) {
    logger.warn(`Unable to delete original upload ${basename(filePath)}: ${cleanupError}`);
  }

  return { path: finalPath, filename: finalFilename };
}
