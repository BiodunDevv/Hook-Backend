import { HydratedDocument, Model, Schema, SchemaDefinition, model, models } from 'mongoose';

export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export type MongoDocument<T> = HydratedDocument<T & BaseEntity>;

export function createSchema<T>(definition: SchemaDefinition<T>): Schema<T> {
  const schema = new Schema<T>(
    definition,
    {
      timestamps: true,
      versionKey: false,
      toJSON: {
        virtuals: true,
        transform: (_doc, ret: any) => {
          ret.id = ret._id?.toString();
          delete ret._id;
          return ret;
        },
      },
      toObject: {
        virtuals: true,
        transform: (_doc, ret: any) => {
          ret.id = ret._id?.toString();
          delete ret._id;
          return ret;
        },
      },
    },
  );

  schema.virtual('id').get(function getId(this: { _id?: any }) {
    return this._id?.toString();
  });

  return schema;
}

export function createModel<T>(name: string, schema: Schema<T>) {
  return (models[name] || model<T>(name, schema)) as Model<T>;
}
