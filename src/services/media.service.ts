import { HttpError } from '@utils/http';

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
  error?: { message?: string };
}

const imageExtensionPattern = /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i;
const knownImageHosts = [
  'cloudinary.com',
  'images.unsplash.com',
  'plus.unsplash.com',
  'images.pexels.com',
  'cdn.shopify.com',
  'res.cloudinary.com',
];

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
  const looksLikeImage = imageExtensionPattern.test(parsed.pathname) || knownImageHosts.some((item) => host === item || host.endsWith(`.${item}`));
  if (!looksLikeImage) {
    throw new HttpError(400, `Image URL must point to a supported image resource: ${value}`);
  }
}

function parseCloudinaryAsset(payload: CloudinaryUploadResponse, file: Express.Multer.File): MediaAsset {
  if (payload.error?.message) throw new HttpError(502, payload.error.message);
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
    size: payload.bytes || file.size,
    originalName: file.originalname,
    mimetype: file.mimetype,
  };
}

export class MediaService {
  async uploadImage(file: Express.Multer.File): Promise<MediaAsset> {
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
    const uploaded = await Promise.all(files.map((file) => this.uploadImage(file)));
    const external = urls.filter(Boolean).map((url) => this.fromExternalUrl(url));
    return [...uploaded, ...external];
  }
}
