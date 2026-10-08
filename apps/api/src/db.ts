import pg from 'pg';
import type { Config } from './config.js';

export const { Pool } = pg;

export function createPool(config: Config) {
  return new Pool({ connectionString: config.DATABASE_URL, max: 15, statement_timeout: 5000 });
}

export type Db = ReturnType<typeof createPool>;
