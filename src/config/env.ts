const unsafeJwtSecrets = new Set([
  'change-me-in-production',
  'hook-dev-jwt-secret-change-in-production-12345',
  'secret',
  'password',
]);

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function jwtSecret() {
  return requireEnv('JWT_SECRET');
}

export function parseOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || raw.trim() === '') {
    if (isProduction()) throw new Error('CORS_ORIGINS is required in production');
    return ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'];
  }
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function assertSafeEnvironment() {
  requireEnv('MONGODB_URI');
  const secret = jwtSecret();
  const origins = parseOrigins();

  if (isProduction()) {
    if (unsafeJwtSecrets.has(secret) || secret.length < 32) {
      throw new Error('JWT_SECRET must be a strong production secret with at least 32 characters');
    }
    if (origins.includes('*')) {
      throw new Error('CORS_ORIGINS cannot be * in production when credentials are enabled');
    }
    for (const origin of origins) {
      if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) {
        throw new Error(`Invalid CORS origin: ${origin}`);
      }
    }
    if (process.env.CLOUDINARY_UPLOADS_ENABLED !== 'false') {
      requireEnv('CLOUDINARY_CLOUD_NAME');
      requireEnv('CLOUDINARY_UPLOAD_PRESET');
    }
  }
}

export function apiDocsEnabled() {
  return !isProduction() || process.env.ENABLE_API_DOCS === 'true';
}
