export const dateTimeColumnType = process.env.DB_TYPE === 'sqlite' ? 'datetime' : 'timestamptz';
