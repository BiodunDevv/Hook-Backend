import multer from 'multer';
import { HttpError } from '@utils/http';

const allowedTypes = (process.env.UPLOAD_ALLOWED_TYPES || 'image/jpeg,image/png,image/webp,image/gif')
  .split(',')
  .map((type) => type.trim())
  .filter(Boolean);

const maxFileSizeMb = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 5);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new HttpError(400, `Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});
