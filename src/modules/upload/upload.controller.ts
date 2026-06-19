import {
  Controller, Post, Get, Param, UseInterceptors, UploadedFile, UploadedFiles,
  MaxFileSizeValidator, ParseFilePipe, FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { UploadService } from './upload.service';
import { success, created } from '@common/dto/api-response.dto';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuid } from 'uuid';

@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/images',
        filename: (_, file, cb) => {
          const name = `${uuid()}${extname(file.originalname)}`;
          cb(null, name);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|png|webp|jpg)$/)) {
          cb(new Error('Only image files allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload a single image' })
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    const url = await this.uploadService.saveImage(file);
    return created({ url, filename: file.filename }, 'Image uploaded');
  }

  @Post('images')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: './uploads/images',
        filename: (_, file, cb) => {
          const name = `${uuid()}${extname(file.originalname)}`;
          cb(null, name);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } })
  @ApiOperation({ summary: 'Upload multiple images' })
  async uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
    const urls = await Promise.all(files.map(f => this.uploadService.saveImage(f)));
    return created({ urls, count: urls.length }, 'Images uploaded');
  }
}
