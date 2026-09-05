import { HydratedDocument, Model, Schema, SchemaDefinition, model, models } from 'mongoose';
import leanVirtuals from 'mongoose-lean-virtuals';

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

  /**
   * Mongoose's built-in `.lean({ virtuals: true })` only auto-includes
   * populated-relation virtuals, not plain getter virtuals like `id` above —
   * without this plugin every `.lean({ virtuals: true })` call across the
   * codebase silently returns `id: undefined`, even though `_id` is present.
   * This plugin makes lean queries actually compute schema.virtual() getters.
   */
  schema.plugin(leanVirtuals);

  return schema;
}

export function createModel<T>(name: string, schema: Schema<T>, collectionName?: string) {
  return (models[name] || model<T>(name, schema, collectionName)) as Model<T>;
}
