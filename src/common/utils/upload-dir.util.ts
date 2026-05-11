import { isAbsolute, join } from 'path';

const HOSTINGER_UPLOAD_DIR = '/home/u505661520/public_html/uploads';

function isProductionEnv() {
  return ['production', 'prod'].includes((process.env.NODE_ENV || '').toLowerCase());
}

export function resolveUploadDir(folder?: string) {
  const baseDir = isProductionEnv()
    ? process.env.UPLOAD_DIR || HOSTINGER_UPLOAD_DIR
    : process.env.UPLOAD_DIR_LOCAL || 'uploads';
  const uploadRoot = isAbsolute(baseDir) ? baseDir : join(process.cwd(), baseDir);
  return folder ? join(uploadRoot, folder) : uploadRoot;
}
