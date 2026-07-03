import multer from 'multer';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { HttpError } from '@utils/http';

const uploadDir = join(process.cwd(), 'uploads');
mkdirSync(uploadDir, { recursive: true });

const allowedTypes = (process.env.UPLOAD_ALLOWED_TYPES || 'image/jpeg,image/png,image/webp,image/gif')
  .split(',')
  .map((type) => type.trim())
  .filter(Boolean);

const maxFileSizeMb = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 5);

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new HttpError(400, `Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

export function uploadedFileUrl(file: Express.Multer.File) {
  return `/uploads/${file.filename}`;
}
