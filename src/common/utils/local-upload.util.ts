import { unlink } from 'fs/promises';
import { resolve } from 'path';

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

  const uploadDir = process.env.UPLOAD_DIR || 'uploads';
  const uploadRoot = resolve(process.cwd(), uploadDir);
  const relativePath = path.replace(/^\/uploads\/?/, '');
  const absolutePath = resolve(uploadRoot, relativePath);

  if (!absolutePath.startsWith(uploadRoot)) return null;
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
