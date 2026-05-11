import { unlink } from 'fs/promises';
import { relative, resolve } from 'path';
import { resolveUploadDir } from './upload-dir.util';

function toLocalUploadPath(fileUrl?: string | null) {
  if (!fileUrl) return null;

  let path = fileUrl;
  try {
    const parsed = new URL(fileUrl);
    path = parsed.pathname;
  } catch {
    // Already a relative path.
  }

  if (!path.startsWith('/uploads/')) return null;

  const uploadRoot = resolve(resolveUploadDir());
  const relativePath = path.replace(/^\/uploads\/?/, '');
  const absolutePath = resolve(uploadRoot, relativePath);

  if (relative(uploadRoot, absolutePath).startsWith('..')) return null;
  return absolutePath;
}

export async function deleteLocalUpload(fileUrl?: string | null) {
  const localPath = toLocalUploadPath(fileUrl);
  if (!localPath) return;

  try {
    await unlink(localPath);
  } catch {
    // File cleanup must not fail the business operation.
  }
}

export async function deleteReplacedLocalUpload(previousUrl?: string | null, nextUrl?: string | null) {
  if (!previousUrl || previousUrl === nextUrl) return;
  await deleteLocalUpload(previousUrl);
}
