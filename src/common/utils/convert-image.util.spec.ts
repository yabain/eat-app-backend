import { BadRequestException, Logger, UnsupportedMediaTypeException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const sharp = require('sharp') as typeof import('sharp').default;
import {
  assertImageWithinLimits,
  convertUploadToWebp,
  isConvertibleImageMime,
} from './convert-image.util';

const TINY_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

async function createImage(filePath: string, format: 'jpeg' | 'png' | 'webp' = 'jpeg') {
  const buffer = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .toFormat(format)
    .toBuffer();
  await fs.writeFile(filePath, buffer);
}

async function expectMissing(filePath: string) {
  await expect(fs.access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('isConvertibleImageMime', () => {
  it.each([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/avif',
    'image/tiff',
  ])('accepte %s', (mime) => {
    expect(isConvertibleImageMime(mime)).toBe(true);
  });

  it.each(['image/svg+xml', 'image/svg', 'image/bmp', 'image/x-icon', 'application/pdf', ''])(
    'rejette %s',
    (mime) => {
      expect(isConvertibleImageMime(mime)).toBe(false);
    },
  );
});

describe('assertImageWithinLimits', () => {
  it('accepte une photo de 24 MP', () => {
    expect(() => assertImageWithinLimits({ width: 6000, height: 4000 }, false)).not.toThrow();
  });

  it('rejette une image statique de plus de 25 MP', () => {
    expect(() => assertImageWithinLimits({ width: 6000, height: 5000 }, false)).toThrow(
      BadRequestException,
    );
  });

  it('rejette une animation de plus de 30 images', () => {
    expect(() =>
      assertImageWithinLimits({ width: 800, height: 600, pages: 31 }, true),
    ).toThrow(BadRequestException);
  });

  it('rejette une animation dont le total dépasse 16 MP', () => {
    expect(() =>
      assertImageWithinLimits({ width: 1000, height: 1000, pages: 20 }, true),
    ).toThrow(BadRequestException);
  });

  it('accepte une animation de 30 images en 800 × 600', () => {
    expect(() =>
      assertImageWithinLimits({ width: 800, height: 600, pages: 30 }, true),
    ).not.toThrow();
  });

  it('rejette des dimensions manquantes', () => {
    expect(() => assertImageWithinLimits({}, false)).toThrow(BadRequestException);
  });
});

describe('convertUploadToWebp', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'eat-webp-'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertit un JPEG en WebP et supprime le fichier original', async () => {
    const original = join(dir, 'photo.jpg');
    await createImage(original);

    const result = await convertUploadToWebp(original, 'photo.jpg', 'image/jpeg', dir);

    expect(result.filename).toBe('photo.webp');
    expect(result.path).toBe(join(dir, 'photo.webp'));
    await expect(sharp(result.path).metadata()).resolves.toMatchObject({ format: 'webp' });
    await expectMissing(original);
  });

  it('applique l’orientation EXIF avant la conversion', async () => {
    const original = join(dir, 'rotated.jpg');
    await sharp({
      create: { width: 10, height: 4, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toFile(original);

    const result = await convertUploadToWebp(original, 'rotated.jpg', 'image/jpeg', dir);
    const metadata = await sharp(result.path).metadata();

    expect(metadata.width).toBe(4);
    expect(metadata.height).toBe(10);
    await expectMissing(original);
  });

  it('convertit un GIF en WebP', async () => {
    const original = join(dir, 'animation.gif');
    await fs.writeFile(original, TINY_GIF);

    const result = await convertUploadToWebp(original, 'animation.gif', 'image/gif', dir);

    expect(result.filename).toBe('animation.webp');
    await expect(sharp(result.path).metadata()).resolves.toMatchObject({ format: 'webp' });
    await expectMissing(original);
  });

  it('réencode un WebP avec un nom unique pour ne pas écraser la source', async () => {
    const original = join(dir, 'photo.webp');
    await createImage(original, 'webp');

    const result = await convertUploadToWebp(original, 'photo.webp', 'image/webp', dir);

    expect(result.filename).toMatch(/^photo-[0-9a-f-]+\.webp$/);
    expect(result.path).not.toBe(original);
    await expect(sharp(result.path).metadata()).resolves.toMatchObject({ format: 'webp' });
    await expectMissing(original);
  });

  it('gère un fichier source qui porte déjà l’extension .webp', async () => {
    const original = join(dir, 'photo.webp');
    await createImage(original, 'jpeg');

    const result = await convertUploadToWebp(original, 'photo.webp', 'image/jpeg', dir);

    expect(result.filename).toMatch(/^photo-[0-9a-f-]+\.webp$/);
    expect(result.path).not.toBe(original);
    await expect(sharp(result.path).metadata()).resolves.toMatchObject({ format: 'webp' });
    await expectMissing(original);
  });

  it('réencode un fichier annoncé comme WebP mais dont le contenu ne l’est pas', async () => {
    const original = join(dir, 'spoofed.webp');
    await createImage(original, 'jpeg');

    const result = await convertUploadToWebp(original, 'spoofed.webp', 'image/webp', dir);

    expect(result.filename).toMatch(/^spoofed-[0-9a-f-]+\.webp$/);
    await expect(sharp(result.path).metadata()).resolves.toMatchObject({ format: 'webp' });
    await expectMissing(original);
  });

  it('ajoute .webp sans casser un nom sans extension', async () => {
    const original = join(dir, 'photo');
    await createImage(original);

    const result = await convertUploadToWebp(original, 'photo', 'image/jpeg', dir);

    expect(result.filename).toBe('photo.webp');
    expect(result.path).toBe(join(dir, 'photo.webp'));
  });

  it('rejette une image corrompue et nettoie le fichier temporaire', async () => {
    const original = join(dir, 'broken.jpg');
    await fs.writeFile(original, Buffer.from('not an image'));

    await expect(
      convertUploadToWebp(original, 'broken.jpg', 'image/jpeg', dir),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expectMissing(original);
    await expectMissing(join(dir, 'broken.webp'));
    const leftovers = (await fs.readdir(dir)).filter((name) => name.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('rejette un SVG et supprime le fichier', async () => {
    const original = join(dir, 'logo.svg');
    await fs.writeFile(original, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    await expect(
      convertUploadToWebp(original, 'logo.svg', 'image/svg+xml', dir),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

    await expectMissing(original);
  });

  it('rejette un format non convertible et supprime le fichier', async () => {
    const original = join(dir, 'icon.ico');
    await fs.writeFile(original, Buffer.from('icon'));

    await expect(
      convertUploadToWebp(original, 'icon.ico', 'image/x-icon', dir),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

    await expectMissing(original);
  });

  it('rejette un fichier non image et supprime le fichier', async () => {
    const original = join(dir, 'document.pdf');
    await fs.writeFile(original, Buffer.from('%PDF-1.4'));

    await expect(
      convertUploadToWebp(original, 'document.pdf', 'application/pdf', dir),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

    await expectMissing(original);
  });
});
