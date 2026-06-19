import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UploadService {
  constructor(private configService: ConfigService) {}

  async saveImage(file: Express.Multer.File): Promise<string> {
    // In production, upload to S3/Cloudinary and return URL
    // For dev, return local path
    const baseUrl = this.configService.get('APP_URL', 'http://localhost:3000');
    return `${baseUrl}/uploads/images/${file.filename}`;
  }
}
