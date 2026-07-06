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

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  await mongoose.connect(getMongoUri(), {
    dbName: process.env.MONGODB_DB_NAME || 'hook',
    autoIndex: process.env.NODE_ENV !== 'production',
    serverSelectionTimeoutMS: 10000,
  });

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
