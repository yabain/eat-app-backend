import { promises as fs } from 'fs';
import { extname, join } from 'path';
import sharp from 'sharp';

const CONVERTIBLE_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

const SKIP_MIME = new Set(['image/gif', 'image/svg+xml', 'image/x-icon']);

export async function convertUploadToWebp(
  filePath: string,
  filename: string,
  mimetype: string,
  uploadDir: string,
): Promise<{ path: string; filename: string }> {
  const isHeic = mimetype === 'image/heic' || mimetype === 'image/heif';
  const shouldConvert = !SKIP_MIME.has(mimetype) && CONVERTIBLE_MIME[mimetype] !== undefined;

  if (!shouldConvert) {
    return { path: filePath, filename };
  }

  const webpFilename = filename.replace(extname(filename), '.webp');
  const webpPath = join(uploadDir, webpFilename);

  try {
    let pipeline = sharp(filePath);

    if (isHeic) {
      pipeline = pipeline.rotate();
    }

    await pipeline
      .webp({ quality: 82 })
      .toFile(webpPath);

    await fs.unlink(filePath);

    return { path: webpPath, filename: webpFilename };
  } catch (error) {
    if (!isHeic) {
      try {
        await sharp(filePath).webp({ quality: 82 }).toFile(webpPath);
        await fs.unlink(filePath);
        return { path: webpPath, filename: webpFilename };
      } catch {}
    }
    return { path: filePath, filename };
  }
}