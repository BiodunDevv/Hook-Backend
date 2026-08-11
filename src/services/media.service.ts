import { HttpError } from '@utils/http';
import { v2 as cloudinary } from 'cloudinary';

export interface MediaAsset {
  url: string;
  secureUrl: string;
  publicId?: string;
  source: 'cloudinary' | 'external';
  width?: number;
  height?: number;
  format?: string;
  size?: number;
  originalName?: string;
  mimetype?: string;
}

interface CloudinaryUploadResponse {
  secure_url?: string;
  url?: string;
  public_id?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  resource_type?: string;
  error?: { message?: string };
}

const imageExtensionPattern = /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i;
const defaultAllowedImageHosts = [
  'cloudinary.com',
  'images.unsplash.com',
  'plus.unsplash.com',
  'res.cloudinary.com',
  'encrypted-tbn0.gstatic.com',
  'images.gstatic.com',
];

function allowedImageHosts() {
  return (process.env.ALLOWED_EXTERNAL_IMAGE_HOSTS || defaultAllowedImageHosts.join(','))
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase();
  if (['localhost', 'metadata.google.internal'].includes(host)) return true;
  if (/^(127|10)\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return true;
  return false;
}

function cloudName() {
  return process.env.CLOUDINARY_CLOUD_NAME || process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
}

function uploadPreset() {
  return process.env.CLOUDINARY_UPLOAD_PRESET || process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
}

function assertCloudinaryConfig() {
  if (!cloudName() || !uploadPreset()) {
    throw new HttpError(500, 'Cloudinary upload is not configured');
  }
}

function assertImageUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, `Invalid image URL: ${value}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(400, 'Image URL must start with http or https');
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateHostname(host)) {
    throw new HttpError(400, 'Private or internal image URLs are not allowed');
  }
  const allowed = allowedImageHosts();
  const allowedHost = allowed.some((item) => host === item || host.endsWith(`.${item}`));
  if (!allowedHost) {
    throw new HttpError(400, `Image host is not allowed: ${host}`);
  }
  const looksLikeImage = imageExtensionPattern.test(parsed.pathname) || allowed.some((item) => host === item || host.endsWith(`.${item}`));
  if (!looksLikeImage) {
    throw new HttpError(400, `Image URL must point to a supported image resource: ${value}`);
  }
}

function parseCloudinaryAsset(payload: CloudinaryUploadResponse, file?: Express.Multer.File): MediaAsset {
  if (payload.error?.message) throw new HttpError(502, payload.error.message);
  if (payload.resource_type && payload.resource_type !== 'image') throw new HttpError(400, 'Only image uploads are allowed');
  const secureUrl = payload.secure_url || payload.url;
  if (!secureUrl) throw new HttpError(502, 'Cloudinary did not return an image URL');
  return {
    url: secureUrl,
    secureUrl,
    publicId: payload.public_id,
    source: 'cloudinary',
    width: payload.width,
    height: payload.height,
    format: payload.format,
    size: payload.bytes || file?.size,
    originalName: file?.originalname,
    mimetype: file?.mimetype,
  };
}

export class MediaService {
  async uploadImage(file: Express.Multer.File): Promise<MediaAsset> {
    const cloud = cloudName();
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (cloud && apiKey && apiSecret) {
      cloudinary.config({ cloud_name: cloud, api_key: apiKey, api_secret: apiSecret, secure: true });
      const payload = await new Promise<CloudinaryUploadResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'hook', resource_type: 'image' },
          (error, result) => error || !result ? reject(error || new Error('Cloudinary upload failed')) : resolve(result),
        );
        stream.end(file.buffer);
      });
      return parseCloudinaryAsset(payload, file);
    }
    assertCloudinaryConfig();
    const body = new FormData();
    const blob = new Blob([file.buffer as BlobPart], { type: file.mimetype });
    body.append('file', blob, file.originalname);
    body.append('upload_preset', uploadPreset() as string);
    body.append('folder', process.env.CLOUDINARY_UPLOAD_FOLDER || 'hook');

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName()}/image/upload`, {
      method: 'POST',
      body,
    });
    const payload = (await response.json()) as CloudinaryUploadResponse;
    if (!response.ok) {
      throw new HttpError(response.status >= 500 ? 502 : 400, payload.error?.message || 'Cloudinary upload failed');
    }
    return parseCloudinaryAsset(payload, file);
  }

  async uploadRemoteImage(url: string): Promise<MediaAsset> {
    const cleanUrl = url.trim();
    assertImageUrl(cleanUrl);
    const cloud = cloudName();
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (cloud && apiKey && apiSecret) {
      cloudinary.config({ cloud_name: cloud, api_key: apiKey, api_secret: apiSecret, secure: true });
      const payload = await cloudinary.uploader.upload(cleanUrl, {
        folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'hook',
        resource_type: 'image',
      }) as CloudinaryUploadResponse;
      return parseCloudinaryAsset(payload);
    }

    assertCloudinaryConfig();
    const body = new FormData();
    body.append('file', cleanUrl);
    body.append('upload_preset', uploadPreset() as string);
    body.append('folder', process.env.CLOUDINARY_UPLOAD_FOLDER || 'hook');
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName()}/image/upload`, { method: 'POST', body });
    const payload = (await response.json()) as CloudinaryUploadResponse;
    if (!response.ok) {
      throw new HttpError(response.status >= 500 ? 502 : 400, payload.error?.message || 'Cloudinary could not import this image');
    }
    return parseCloudinaryAsset(payload);
  }

  fromExternalUrl(url: string): MediaAsset {
    const cleanUrl = url.trim();
    assertImageUrl(cleanUrl);
    return {
      url: cleanUrl,
      secureUrl: cleanUrl,
      source: 'external',
    };
  }

  async normalize(files: Express.Multer.File[], urls: string[] = []): Promise<MediaAsset[]> {
    const [uploaded, imported] = await Promise.all([
      Promise.all(files.map((file) => this.uploadImage(file))),
      Promise.all(urls.filter(Boolean).map((url) => this.uploadRemoteImage(url))),
    ]);
    return [...uploaded, ...imported];
  }
}
