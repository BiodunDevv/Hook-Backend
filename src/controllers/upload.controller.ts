import { Request, Response } from 'express';
import { uploadedFileUrl } from '@middleware/upload';
import { HttpError, sendCreated } from '@utils/http';

export class UploadController {
  image = async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, 'Image file is required');
    sendCreated(res, {
      url: uploadedFileUrl(req.file),
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
  };

  images = async (req: Request, res: Response) => {
    const files = (req.files || []) as Express.Multer.File[];
    if (!files.length) throw new HttpError(400, 'At least one image file is required');
    sendCreated(res, files.map((file) => ({
      url: uploadedFileUrl(file),
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
    })));
  };
}
