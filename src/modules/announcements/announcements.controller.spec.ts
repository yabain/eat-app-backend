import { Logger, UnsupportedMediaTypeException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const sharp = require('sharp') as typeof import('sharp').default;
import {
  AnnouncementsController,
  resolveAnnouncementExtension,
} from './announcements.controller';

function attachmentFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'offer.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 0,
    destination: '',
    filename: 'offer.jpg',
    path: '',
    buffer: Buffer.alloc(0),
    stream: null as any,
    ...overrides,
  } as Express.Multer.File;
}

describe('AnnouncementsController attachments', () => {
  let root: string;
  let directory: string;
  let originalUploadDir: string | undefined;
  let originalNodeEnv: string | undefined;
  const service = { buildAttachmentMetadata: jest.fn() };
  let controller: AnnouncementsController;

  // New helper test
  describe('resolveAnnouncementExtension', () => {
    it('returns .webp for image mimes', () => {
      expect(resolveAnnouncementExtension('image/jpeg')).toBe('.webp');
      expect(resolveAnnouncementExtension('image/png')).toBe('.webp');
      expect(resolveAnnouncementExtension('image/webp')).toBe('.webp');
      expect(resolveAnnouncementExtension('image/heic')).toBe('.webp');
    });

    it('returns .pdf for PDF mimes', () => {
      expect(resolveAnnouncementExtension('application/pdf')).toBe('.pdf');
      expect(resolveAnnouncementExtension('application/msword')).toBe('.doc');
    });

    it('returns .docx for Word mimes', () => {
      expect(resolveAnnouncementExtension('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('.docx');
    });

    it('returns .xls for Excel mimes', () => {
      expect(resolveAnnouncementExtension('application/vnd.ms-excel')).toBe('.xls');
      expect(resolveAnnouncementExtension('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('.xlsx');
    });

    it('returns empty string for unknown mime', () => {
      expect(resolveAnnouncementExtension('application/x-unknown')).toBe('');
    });
  });

  beforeEach(async () => {
    originalUploadDir = process.env.UPLOAD_DIR_LOCAL;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    root = await fs.mkdtemp(join(tmpdir(), 'eat-announcements-'));
    process.env.UPLOAD_DIR_LOCAL = root;
    directory = join(root, 'announcements');
    await fs.mkdir(directory, { recursive: true });

    service.buildAttachmentMetadata.mockReset();
    service.buildAttachmentMetadata.mockImplementation((file: Express.Multer.File) => ({
      attachmentUrl: `/uploads/announcements/${file.filename}`,
      attachmentPath: `/uploads/announcements/${file.filename}`,
      attachmentName: file.originalname,
      attachmentMimeType: file.mimetype,
      attachmentSize: file.size,
    }));
    controller = new AnnouncementsController(service as any);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR_LOCAL;
    else process.env.UPLOAD_DIR_LOCAL = originalUploadDir;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('convertit une image jointe en WebP avant de construire les métadonnées', async () => {
    const originalPath = join(directory, 'offer.jpg');
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 128, b: 255 } },
    })
      .jpeg()
      .toBuffer();
    await fs.writeFile(originalPath, image);
    const file = attachmentFile({ path: originalPath, size: image.length });

    const result = await controller.uploadAttachment(file);

    expect(result).toMatchObject({
      attachmentName: 'offer.webp',
      attachmentMimeType: 'image/webp',
      attachmentPath: '/uploads/announcements/offer.webp',
    });
    expect(result.attachmentSize).toBeGreaterThan(0);
    await expect(sharp(join(directory, 'offer.webp')).metadata()).resolves.toMatchObject({
      format: 'webp',
    });
    await expect(fs.access(originalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(service.buildAttachmentMetadata).toHaveBeenCalledWith(file);
  });

  it('laisse un PDF intact', async () => {
    const originalPath = join(directory, 'document.pdf');
    const pdf = Buffer.from('%PDF-1.4 test');
    await fs.writeFile(originalPath, pdf);
    const file = attachmentFile({
      originalname: 'document.pdf',
      filename: 'document.pdf',
      mimetype: 'application/pdf',
      path: originalPath,
      size: pdf.length,
    });

    const result = await controller.uploadAttachment(file);

    expect(result).toMatchObject({
      attachmentName: 'document.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSize: pdf.length,
    });
    await expect(fs.access(originalPath)).resolves.toBeUndefined();
  });

  it('rejette un SVG même si le filtre Multer est contourné', async () => {
    const originalPath = join(directory, 'logo.svg');
    await fs.writeFile(originalPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const file = attachmentFile({
      originalname: 'logo.svg',
      filename: 'logo.svg',
      mimetype: 'image/svg+xml',
      path: originalPath,
    });

    await expect(controller.uploadAttachment(file)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    await expect(fs.access(originalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(service.buildAttachmentMetadata).not.toHaveBeenCalled();
  });
});
