import dotenv from 'dotenv';
import mongoose, { Model } from 'mongoose';
import { MongoRepository } from '@lib/mongo-repository';

dotenv.config({ quiet: true });

export function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }
  return uri;
}

function getMongoHost(uri: string) {
  try {
    return new URL(uri).hostname;
  } catch {
    return 'configured URI';
  }
}

function isRetryableConnectionError(error: unknown) {
  const value = error as { code?: string; name?: string; message?: string };
  const code = String(value?.code || '');
  const message = String(value?.message || '');
  return [
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ETIMEDOUT',
  ].includes(code) || value?.name === 'MongoServerSelectionError' || /server selection|querySrv|timed out/i.test(message);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  const uri = getMongoUri();
  const configuredRetries = Number(process.env.MONGODB_CONNECT_RETRIES);
  const maxAttempts = Number.isInteger(configuredRetries) && configuredRetries > 0 ? configuredRetries : 1;
  const serverSelectionTimeoutMS = Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS)
    || (process.env.NODE_ENV === 'development' ? 5000 : 10000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        autoIndex: process.env.NODE_ENV !== 'production',
        serverSelectionTimeoutMS,
      });
      break;
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableConnectionError(error)) throw error;
      const delay = Math.min(5000, 500 * (2 ** (attempt - 1)));
      console.warn(`⚠️ MongoDB connection attempt ${attempt}/${maxAttempts} failed for ${getMongoHost(uri)}; retrying in ${delay}ms`);
      await mongoose.disconnect().catch(() => undefined);
      await wait(delay);
    }
  }

  console.log(`✅ MongoDB Connected: ${getMongoHost(uri)}`);
  console.log(`   Database: ${mongoose.connection.name}`);

  return mongoose.connection;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export const initializeDatabase = connectDatabase;

export const AppDataSource = {
  get isInitialized() {
    return mongoose.connection.readyState === 1;
  },
  initialize: connectDatabase,
  destroy: disconnectDatabase,
  getRepository<T extends { id?: string }>(model: Model<T>) {
    return new MongoRepository<T>(model);
  },
};

export default AppDataSource;
