import { Router } from 'express';
import { UploadController } from '@controllers/upload.controller';
import { requireAuth } from '@middleware/auth';
import { upload } from '@middleware/upload';
import { asyncHandler } from '@utils/http';

export function createUploadRouter() {
  const router = Router();
  const controller = new UploadController();

  router.use(requireAuth);
  router.post('/image', upload.single('image'), asyncHandler(controller.image));
  router.post('/images', upload.array('images', Number(process.env.UPLOAD_MAX_FILES || 8)), asyncHandler(controller.images));

  return router;
}
